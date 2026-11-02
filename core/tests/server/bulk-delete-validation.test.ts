import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import {
    BULK_TRASH_BATCH_SIZE,
    deleteFiles,
    validateBulkDelete
} from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { EMAIL, file, input } from '../helpers/bulk-delete';

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

test('a media key and sha1 mismatch is rejected before any provider request', async () => {
    const first = file('first.bin', 1);
    const request = input([first]);
    request.files[0][3][0][1] = file('other.bin', 1).chunks[0].sha1;
    const results: unknown[] = [];

    const result = await deleteFiles(request, (event) => results.push(event));

    expect(result.unwrapErr().code).toBe('INVALID_FILE_METADATA');
    expect(results).toEqual([]);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('a chunk from another file identity is rejected before any provider request', async () => {
    const first = file('first.bin', 1);
    const other = file('other.bin', 1);
    const request = input([first]);
    request.files[0][1] = other.fileHash;
    request.files[0][2] = other.fileId;

    const result = await deleteFiles(request, () => {});

    expect(result.unwrapErr().code).toBe('INVALID_FILE_METADATA');
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('invalid bulk metadata is rejected before any provider request', async () => {
    const invalid = validateBulkDelete(input([{ ...file('first.bin', 1), chunks: [] }]));
    const result = await deleteFiles(input([{ ...file('first.bin', 1), chunks: [] }]), () => {});

    expect(invalid.isErr()).toBe(true);
    expect(result.isErr()).toBe(true);
    expect(vi.mocked(moveToTrashBatch)).not.toHaveBeenCalled();
});
