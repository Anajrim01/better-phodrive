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

test('permanent delete and restore keep confirmed fallback chunks and report partial failure', async () => {
    for (const scenario of SCENARIOS.slice(1)) {
        vi.clearAllMocks();
        const item = file(`partial-${scenario.action}.bin`, 2, true);
        vi.mocked(scenario.batch).mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'REQUEST_FAILED',
                    message: 'Batch rejected',
                    stage:
                        scenario.action === FileActionKind.DeleteForever
                            ? 'Delete permanently'
                            : 'Restore from trash',
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
        {
            code: 'REQUEST_FAILED',
            message: 'Delete permanently failed (HTTP 500)',
            stage: 'Delete permanently',
            status: 500
        },
        {
            code: 'REQUEST_FAILED',
            message: 'Delete permanently timed out',
            stage: 'Delete permanently'
        }
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
