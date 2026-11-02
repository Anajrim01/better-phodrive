import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { deleteFiles, validateBulkDelete } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { file, input, request, saveState } from '../helpers/bulk-delete';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
}));

let folder = '';

function ok(): ReturnType<typeof ensureAccountIndex> {
    return Ok(undefined).andThenAsync(async () => Ok(undefined));
}

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
    vi.mocked(ensureAccountIndex).mockImplementation(() => ok());
    vi.mocked(refreshAccountIndex).mockImplementation(() => ok());
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

test('a media key and sha1 mismatch is rejected before any provider request', async () => {
    const first = file('first.bin', 1);
    const payload = input([first]);
    payload.files[0][3][0][1] = file('other.bin', 1).chunks[0].sha1;
    const results: { index: number; name: string; deleted: number; error?: string }[] = [];

    const result = await deleteFiles(payload, (event) => {
        results.push({
            index: event.index,
            name: event.name,
            deleted: event.deleted.length,
            ...(event.error ? { error: event.error } : {})
        });
    });

    expect(result.isOk()).toBe(true);
    expect(results).toEqual([
        { index: 0, name: 'first.bin', deleted: 0, error: 'Invalid file metadata.' }
    ]);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('a chunk from another file identity is rejected before any provider request', async () => {
    const first = file('first.bin', 1);
    const other = file('other.bin', 1);
    const payload = input([first]);
    payload.files[0][1] = other.fileHash;
    payload.files[0][2] = other.fileId;

    const results: string[] = [];
    const result = await deleteFiles(payload, (event) => results.push(event.error ?? ''));

    expect(result.isOk()).toBe(true);
    expect(results).toEqual(['Invalid file metadata.']);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('invalid bulk metadata is rejected before any provider request', async () => {
    const payload = input([{ ...file('first.bin', 1), chunks: [] }]);
    const invalid = await validateBulkDelete(payload);
    const result = await deleteFiles(payload, () => {});

    expect(invalid.isErr()).toBe(true);
    expect(result.isErr()).toBe(true);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('missing library state is built before validation', async () => {
    const first = file('first.bin', 1);
    const payload = request([first]);
    const results: string[] = [];

    vi.mocked(ensureAccountIndex).mockImplementation(() => {
        saveState([first]);

        return ok();
    });

    const result = await deleteFiles(payload, (event) => results.push(event.name));

    expect(result.isOk()).toBe(true);
    expect(ensureAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(results).toEqual(['first.bin']);
});

test('a newly built index is not refreshed a second time', async () => {
    const first = file('first.bin', 2);
    const payload = request([first]);

    vi.mocked(ensureAccountIndex).mockImplementation(() => {
        saveState([{ ...first, chunks: [first.chunks[0]] }]);

        return ok();
    });

    const results: string[] = [];
    const result = await deleteFiles(payload, (event) => results.push(event.error ?? ''));

    expect(result.isOk()).toBe(true);
    expect(results).toEqual(['Invalid file metadata.']);
    expect(ensureAccountIndex).toHaveBeenCalledOnce();
    expect(refreshAccountIndex).not.toHaveBeenCalled();
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('a stale index is refreshed once and revalidated', async () => {
    const first = file('first.bin', 2);
    saveState([{ ...first, chunks: [first.chunks[0]] }]);
    const payload = request([first]);
    const results: string[] = [];

    vi.mocked(refreshAccountIndex).mockImplementation(() => {
        saveState([first]);

        return ok();
    });

    const result = await deleteFiles(payload, (event) => results.push(event.name));

    expect(result.isOk()).toBe(true);
    expect(ensureAccountIndex).not.toHaveBeenCalled();
    expect(refreshAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(results).toEqual(['first.bin']);
});

test('validation fails when the refreshed index still misses a chunk', async () => {
    const first = file('first.bin', 2);
    saveState([{ ...first, chunks: [first.chunks[0]] }]);
    const payload = request([first]);

    const results: string[] = [];
    const result = await deleteFiles(payload, (event) => results.push(event.error ?? ''));

    expect(result.isOk()).toBe(true);
    expect(results).toEqual(['Invalid file metadata.']);
    expect(refreshAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('a stale file fails alone while valid files are still trashed', async () => {
    const valid = file('valid.bin', 1);
    const stale = file('stale.bin', 1);
    saveState([valid]);
    const payload = request([valid, stale]);
    const results: { index: number; name: string; deleted: number; error?: string }[] = [];

    const result = await deleteFiles(payload, (event) => {
        results.push({
            index: event.index,
            name: event.name,
            deleted: event.deleted.length,
            ...(event.error ? { error: event.error } : {})
        });
    });

    expect(result.isOk()).toBe(true);
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(results.toSorted((first, second) => first.index - second.index)).toEqual([
        { index: 0, name: 'valid.bin', deleted: 1 },
        { index: 1, name: 'stale.bin', deleted: 0, error: 'Invalid file metadata.' }
    ]);
});

test('a failed index refresh stops before any provider request', async () => {
    const first = file('first.bin', 2);
    saveState([{ ...first, chunks: [first.chunks[0]] }]);
    const payload = request([first]);

    vi.mocked(refreshAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Refresh failed' } as const)
        )
    );

    const result = await deleteFiles(payload, () => {});

    expect(result.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});
