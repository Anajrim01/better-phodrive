import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { BULK_TRASH_BATCH_SIZE, deleteFiles } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { file, input } from '../helpers/bulk-delete';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-delete-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

test('a rejected batch retries each key and keeps confirmed chunks', async () => {
    const first = file('first.bin', 3);
    const results: { deleted: number; error?: string }[] = [];
    let active = 0;
    let peak = 0;

    vi.mocked(moveToTrashBatch).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'REQUEST_FAILED',
                message: 'Batch rejected',
                stage: 'Move to trash',
                status: 400
            } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation((_email, _token, sha1) =>
        Ok(undefined).andThenAsync(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active--;

            return sha1 === first.chunks[1].sha1
                ? Err({ code: 'REQUEST_FAILED', message: 'Single key failed' } as const)
                : Ok(undefined);
        })
    );

    await deleteFiles(input([first]), (result) => {
        results.push({
            deleted: result.deleted.length,
            ...(result.error ? { error: result.error } : {})
        });
    });

    expect(moveToTrash).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);
    expect(results).toEqual([{ deleted: 2, error: 'Single key failed' }]);
});

test('fallback stops sending keys after a throttle', async () => {
    const files = [file('first.bin', 1), file('second.bin', 1), file('third.bin', 1)];
    const results: { error?: string; retryAfterSeconds?: number }[] = [];

    vi.mocked(moveToTrashBatch).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'REQUEST_FAILED',
                message: 'Batch rejected',
                stage: 'Move to trash',
                status: 400
            } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 5
            } as const)
        )
    );

    await deleteFiles({ ...input(files), workers: 1 }, (result) => {
        results.push({
            ...(result.error ? { error: result.error } : {}),
            ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
        });
    });

    expect(moveToTrash).toHaveBeenCalledOnce();
    expect(results).toEqual([
        { error: expect.stringContaining('limiting requests'), retryAfterSeconds: 5 },
        { error: expect.stringContaining('limiting requests'), retryAfterSeconds: 5 },
        { error: expect.stringContaining('limiting requests'), retryAfterSeconds: 5 }
    ]);
});

test('a fallback throttle stops later batches', async () => {
    const first = file('first.bin', BULK_TRASH_BATCH_SIZE);
    const second = file('second.bin', 1);
    const results: { name: string; deleted: number; error?: string }[] = [];

    vi.mocked(moveToTrashBatch).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'REQUEST_FAILED',
                message: 'Batch rejected',
                stage: 'Move to trash',
                status: 400
            } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 5
            } as const)
        )
    );

    await deleteFiles({ ...input([first, second]), workers: 1 }, (result) => {
        results.push({
            name: result.name,
            deleted: result.deleted.length,
            ...(result.error ? { error: result.error } : {})
        });
    });

    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(moveToTrash).toHaveBeenCalledOnce();
    expect(results).toEqual([
        {
            name: 'first.bin',
            deleted: 0,
            error: expect.stringContaining('limiting requests')
        },
        {
            name: 'second.bin',
            deleted: 0,
            error: expect.stringContaining('limiting requests')
        }
    ]);
});

test('a throttled batch uses manual retry wording and keeps the wait', async () => {
    const results: { error?: string; retryAfterSeconds?: number }[] = [];

    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 7
            } as const)
        )
    );

    await deleteFiles(
        input([file('first.bin', 1), file('second.bin', 1)]),
        (result) => {
            results.push({
                ...(result.error ? { error: result.error } : {}),
                ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
            });
        },
        'manual'
    );

    expect(results).toEqual([
        { error: expect.stringContaining('try again'), retryAfterSeconds: 7 },
        { error: expect.stringContaining('try again'), retryAfterSeconds: 7 }
    ]);
    expect(moveToTrash).not.toHaveBeenCalled();
});
