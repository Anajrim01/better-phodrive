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

test('confirmed permanent delete batches survive a later ambiguous failure', async () => {
    const item = file('split.bin', BULK_TRASH_BATCH_SIZE + 1, true);
    vi.mocked(deletePermanently)
        .mockImplementationOnce(succeeded)
        .mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'REQUEST_FAILED',
                    message: 'Delete permanently timed out',
                    stage: 'Delete permanently'
                } as const)
            )
        );
    const results: { deleted: number; error?: string }[] = [];

    await deleteFiles(input([item], 1, FileActionKind.DeleteForever), (event) => {
        results.push({
            deleted: event.deleted.length,
            ...(event.error ? { error: event.error } : {})
        });
    });

    expect(deletePermanently).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
        { deleted: BULK_TRASH_BATCH_SIZE, error: 'Delete permanently timed out' }
    ]);

    const state = readAccountState(EMAIL);
    expect(state?.items.has(item.chunks[0].mediaKey)).toBe(false);
    expect(state?.items.has(item.chunks[BULK_TRASH_BATCH_SIZE - 1].mediaKey)).toBe(false);
    expect(state?.items.has(item.chunks[BULK_TRASH_BATCH_SIZE].mediaKey)).toBe(true);
});

test('an authentication rejection does not trigger permanent delete fallback', async () => {
    const item = file('auth-rejected.bin', 2, true);
    vi.mocked(deletePermanently).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'REQUEST_FAILED',
                message: 'Authentication failed (HTTP 400)',
                stage: 'Authentication',
                status: 400
            } as const)
        )
    );
    const results: { deleted: number; error?: string }[] = [];

    await deleteFiles(input([item], 1, FileActionKind.DeleteForever), (event) => {
        results.push({
            deleted: event.deleted.length,
            ...(event.error ? { error: event.error } : {})
        });
    });

    expect(deletePermanently).toHaveBeenCalledOnce();
    expect(results).toEqual([{ deleted: 0, error: 'Authentication failed (HTTP 400)' }]);
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
