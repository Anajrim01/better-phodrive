import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { BULK_TRASH_BATCH_SIZE, deleteFiles } from '@madkarmaa/phodrive-core/server/files';
import {
    deletePermanently,
    moveToTrash,
    moveToTrashBatch,
    restoreFromTrash
} from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
import { EMAIL, file, input, request, saveState } from '../helpers/bulk-delete';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    deletePermanently: vi.fn(),
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn(),
    restoreFromTrash: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
}));

const SCENARIOS = [
    {
        action: FileActionKind.Delete,
        batch: moveToTrashBatch,
        single: moveToTrash,
        trashed: false
    },
    {
        action: FileActionKind.DeleteForever,
        batch: deletePermanently,
        single: deletePermanently,
        trashed: true
    },
    {
        action: FileActionKind.Restore,
        batch: restoreFromTrash,
        single: restoreFromTrash,
        trashed: true
    }
] as const;

let folder = '';

function succeeded() {
    return Ok(undefined).andThenAsync(async () => Ok(undefined));
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-actions-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
    vi.mocked(deletePermanently).mockImplementation(succeeded);
    vi.mocked(moveToTrash).mockImplementation(succeeded);
    vi.mocked(moveToTrashBatch).mockImplementation(succeeded);
    vi.mocked(restoreFromTrash).mockImplementation(succeeded);
    vi.mocked(ensureAccountIndex).mockImplementation(succeeded);
    vi.mocked(refreshAccountIndex).mockImplementation(succeeded);
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

test('all three actions batch 1711 keys into four provider requests', async () => {
    for (const scenario of SCENARIOS) {
        vi.clearAllMocks();
        const files = Array.from({ length: 1711 }, (_, index) =>
            file(`file-${index}.bin`, 1, scenario.trashed)
        );
        const results: string[] = [];

        const result = await deleteFiles(input(files, 2, scenario.action), (event) => {
            expect(event.action).toBe(scenario.action);
            results.push(event.name);
        });

        expect(result.isOk()).toBe(true);
        expect(vi.mocked(scenario.batch).mock.calls.map((call) => call[2].length)).toEqual([
            BULK_TRASH_BATCH_SIZE,
            BULK_TRASH_BATCH_SIZE,
            BULK_TRASH_BATCH_SIZE,
            211
        ]);
        expect(results).toHaveLength(1711);
    }
});

test('permanent delete removes chunks and restore clears the trashed mark', async () => {
    const removed = file('removed.bin', 2, true);

    await deleteFiles(input([removed], 2, FileActionKind.DeleteForever), () => {});

    const afterDelete = readAccountState(EMAIL);
    expect(afterDelete?.items.has('removed.bin-0')).toBe(false);
    expect(afterDelete?.items.has('removed.bin-1')).toBe(false);

    const restored = file('restored.bin', 2, true);

    await deleteFiles(input([restored], 2, FileActionKind.Restore), () => {});

    const afterRestore = readAccountState(EMAIL);
    expect(afterRestore?.items.get('restored.bin-0')?.trashedAt).toBeUndefined();
    expect(afterRestore?.items.get('restored.bin-1')?.trashedAt).toBeUndefined();
});

test('a valid file after an index gap is processed for every action', async () => {
    for (const scenario of SCENARIOS) {
        vi.clearAllMocks();
        const stale = file('stale.bin', 1, scenario.trashed);
        const valid = file('valid.bin', 1, scenario.trashed);
        saveState([valid]);
        const results: { index: number; name: string; action: string; error?: string }[] = [];

        await deleteFiles(request([stale, valid], 2, scenario.action), (event) => {
            results.push({
                index: event.index,
                name: event.name,
                action: event.action,
                ...(event.error ? { error: event.error } : {})
            });
        });

        expect(scenario.batch).toHaveBeenCalledOnce();
        expect(results.toSorted((first, second) => first.index - second.index)).toEqual([
            {
                index: 0,
                name: 'stale.bin',
                action: scenario.action,
                error: 'Invalid file metadata.'
            },
            { index: 1, name: 'valid.bin', action: scenario.action }
        ]);
    }
});

test('delete rejects a file when one selected chunk is already trashed', async () => {
    const mixed = file('mixed.bin', 2);
    saveState([mixed]);
    const stored = readAccountState(EMAIL)?.items.get('mixed.bin-1');
    if (stored) stored.trashedAt = 1;
    const results: { index: number; name: string; error?: string }[] = [];

    const result = await deleteFiles(request([mixed]), (event) => {
        results.push({
            index: event.index,
            name: event.name,
            ...(event.error ? { error: event.error } : {})
        });
    });

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([
        { index: 0, name: 'mixed.bin', error: 'Only active chunks can be moved to trash.' }
    ]);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('permanent delete and restore reject active chunks before any request', async () => {
    for (const scenario of SCENARIOS.slice(1)) {
        vi.clearAllMocks();
        const active = file('active.bin', 1);
        const results: { index: number; name: string; action: string; error?: string }[] = [];

        const result = await deleteFiles(input([active], 2, scenario.action), (event) => {
            results.push({
                index: event.index,
                name: event.name,
                action: event.action,
                ...(event.error ? { error: event.error } : {})
            });
        });

        expect(result.isOk()).toBe(true);
        expect(results).toEqual([
            {
                index: 0,
                name: 'active.bin',
                action: scenario.action,
                error: 'Only trashed chunks can be restored or deleted forever.'
            }
        ]);
        expect(scenario.batch).not.toHaveBeenCalled();
        expect(scenario.single).not.toHaveBeenCalled();
    }
});
