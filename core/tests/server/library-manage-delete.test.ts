import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { FolderManageAction } from '@madkarmaa/phodrive-core/manage';
import { manageFolder } from '@madkarmaa/phodrive-core/server/folders';
import { moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    MANAGE_EMAIL,
    MANAGE_TOKEN,
    chunk,
    id,
    saveItems,
    savedItems,
    sha
} from '../helpers/manage';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    deletePermanently: vi.fn()
}));

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-manage-delete-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
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

test('deleting a folder moves active chunks to trash and marks the index', async () => {
    const one = id('one');
    const partial = id('partial');
    const nested = id('nested');
    saveItems([
        chunk(one, 'one', { name: 'one.bin', folder: 'A' }),
        chunk(partial, 'partial-0', { name: 'partial.bin', folder: 'A', last: false }),
        chunk(partial, 'partial-1', { index: 1, trashedAt: 1 }),
        chunk(nested, 'nested', { name: 'nested.bin', folder: 'A/sub' })
    ]);

    const result = await manageFolder({
        action: FolderManageAction.Delete,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        workers: 2
    });

    const value = result.unwrap();
    expect(value.fileCount).toBe(3);
    expect(value.failed).toEqual([]);
    expect(value.items).toHaveLength(3);
    expect(
        vi
            .mocked(moveToTrash)
            .mock.calls.map((call) => call[2])
            .sort()
    ).toEqual(['one', 'partial-0', 'nested'].map(sha).sort());
    expect(savedItems().every((item) => item.trashedAt !== undefined)).toBe(true);
    expect(readAccountState(MANAGE_EMAIL)?.revision).toBe(6);
});

test('a failed folder delete keeps the failed file active and reports it', async () => {
    const one = id('one');
    const two = id('two');
    saveItems([
        chunk(one, 'one', { name: 'one.bin', folder: 'A' }),
        chunk(two, 'two', { name: 'two.bin', folder: 'A' })
    ]);
    vi.mocked(moveToTrash).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Google Photos refused' } as const)
        )
    );

    const result = await manageFolder({
        action: FolderManageAction.Delete,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        workers: 1
    });

    const value = result.unwrap();
    expect(value.fileCount).toBe(2);
    expect(value.failed).toHaveLength(1);
    expect(value.items).toHaveLength(1);
    const items = savedItems();
    expect(items.filter((item) => item.trashedAt === undefined)).toHaveLength(1);
    expect(items.filter((item) => item.trashedAt !== undefined)).toHaveLength(1);
});

test('a folder that is already empty of active files reports zero without failing', async () => {
    saveItems([chunk(id('trashed'), 'trashed', { name: 'gone.bin', folder: 'A', trashedAt: 1 })]);

    const result = await manageFolder({
        action: FolderManageAction.Delete,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        workers: 1
    });

    expect(result.unwrap().fileCount).toBe(0);
    expect(moveToTrash).not.toHaveBeenCalled();
});
