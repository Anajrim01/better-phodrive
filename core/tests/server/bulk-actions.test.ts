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
import { EMAIL, file, input } from '../helpers/bulk-delete';

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

test('permanent delete and restore reject active chunks before any request', async () => {
    for (const scenario of SCENARIOS.slice(1)) {
        vi.clearAllMocks();
        const active = file('active.bin', 1);
        const results: unknown[] = [];

        const result = await deleteFiles(input([active], 2, scenario.action), (event) =>
            results.push(event)
        );

        expect(result.unwrapErr().code).toBe('NOT_TRASHED');
        expect(results).toEqual([]);
        expect(scenario.batch).not.toHaveBeenCalled();
        expect(scenario.single).not.toHaveBeenCalled();
    }
});

test('permanent delete and restore keep confirmed fallback chunks and report partial failure', async () => {
    for (const scenario of SCENARIOS.slice(1)) {
        vi.clearAllMocks();
        const item = file(`partial-${scenario.action}.bin`, 2, true);
        vi.mocked(scenario.batch).mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'REQUEST_FAILED',
                    message: 'Batch rejected',
                    status: 400
                } as const)
            )
        );
        vi.mocked(scenario.single).mockImplementation((_email, _token, sha1s) =>
            Ok(undefined).andThenAsync(async () =>
                sha1s[0] === item.chunks[1].sha1
                    ? Err({ code: 'REQUEST_FAILED', message: 'Single key failed' } as const)
                    : Ok(undefined)
            )
        );
        const results: { deleted: number; error?: string }[] = [];

        await deleteFiles(input([item], 1, scenario.action), (event) => {
            results.push({
                deleted: event.deleted.length,
                ...(event.error ? { error: event.error } : {})
            });
        });

        expect(
            vi.mocked(scenario.single).mock.calls.filter((call) => call[2].length === 1)
        ).toHaveLength(2);
        expect(results).toEqual([{ deleted: 1, error: 'Single key failed' }]);

        const state = readAccountState(EMAIL);
        if (scenario.action === FileActionKind.DeleteForever) {
            expect(state?.items.has(item.chunks[0].mediaKey)).toBe(false);
            expect(state?.items.has(item.chunks[1].mediaKey)).toBe(true);
        } else {
            expect(state?.items.get(item.chunks[0].mediaKey)?.trashedAt).toBeUndefined();
            expect(state?.items.get(item.chunks[1].mediaKey)?.trashedAt).toBe(1);
        }
    }
});

test('ambiguous permanent delete failures are not retried per key', async () => {
    const failures = [
        { code: 'REQUEST_FAILED', message: 'Delete permanently failed (HTTP 500)', status: 500 },
        { code: 'REQUEST_FAILED', message: 'Delete permanently timed out' }
    ] as const;

    for (const failure of failures) {
        vi.clearAllMocks();
        const item = file(`ambiguous-${failure.message.length}.bin`, 2, true);
        vi.mocked(deletePermanently).mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () => Err(failure))
        );
        const results: { deleted: number; error?: string }[] = [];

        await deleteFiles(input([item], 1, FileActionKind.DeleteForever), (event) => {
            results.push({
                deleted: event.deleted.length,
                ...(event.error ? { error: event.error } : {})
            });
        });

        expect(deletePermanently).toHaveBeenCalledOnce();
        expect(vi.mocked(deletePermanently).mock.calls[0]?.[2]).toEqual(
            item.chunks.map((chunk) => chunk.sha1)
        );
        expect(results).toEqual([{ deleted: 0, error: failure.message }]);

        const state = readAccountState(EMAIL);
        expect(state?.items.has(item.chunks[0].mediaKey)).toBe(true);
        expect(state?.items.has(item.chunks[1].mediaKey)).toBe(true);
    }
});

test('a throttle in one batch stops later permanent delete and restore batches', async () => {
    for (const scenario of SCENARIOS.slice(1)) {
        vi.clearAllMocks();
        const first = file(`first-${scenario.action}.bin`, BULK_TRASH_BATCH_SIZE, true);
        const second = file(`second-${scenario.action}.bin`, 1, true);
        vi.mocked(scenario.batch).mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'THROTTLED',
                    message: 'Google Photos is limiting requests',
                    retryAfterSeconds: 5
                } as const)
            )
        );
        const results: { retryAfterSeconds?: number }[] = [];

        await deleteFiles(input([first, second], 1, scenario.action), (event) => {
            results.push({
                ...(event.retryAfterSeconds ? { retryAfterSeconds: event.retryAfterSeconds } : {})
            });
        });

        expect(scenario.batch).toHaveBeenCalledOnce();
        expect(
            vi.mocked(scenario.single).mock.calls.filter((call) => call[2].length === 1)
        ).toEqual([]);
        expect(results).toEqual([{ retryAfterSeconds: 5 }, { retryAfterSeconds: 5 }]);
    }
});
