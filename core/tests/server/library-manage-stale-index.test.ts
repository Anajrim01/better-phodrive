import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { FolderManageAction } from '@madkarmaa/phodrive-core/manage';
import { manageFolder } from '@madkarmaa/phodrive-core/server/folders';
import { moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    SYNC_ONE,
    emptyCounts,
    fetcherFor,
    fileChunk,
    pageBytes,
    type Item
} from '../helpers/delta-library';
import {
    MANAGE_EMAIL,
    MANAGE_TOKEN,
    chunk,
    id,
    overrides,
    primeManageAuth,
    saveItems,
    savedItems
} from '../helpers/manage';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    deletePermanently: vi.fn()
}));

let folder = '';

function pageFetcher(items: readonly Item[], status?: number) {
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_ONE }),
        ...(status === undefined ? {} : { pageStatus: status })
    });

    return { counts, fetcher };
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-manage-stale-'));
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

test('a stale index delete refreshes and trashes each folder chunk once', async () => {
    const fresh = fileChunk(7, 0, 1, 'A');
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([fresh]);

    const result = await manageFolder(
        {
            action: FolderManageAction.Delete,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            workers: 1
        },
        fetcher
    );

    const value = result.unwrap();
    expect(value.fileCount).toBe(1);
    expect(value.failed).toEqual([]);
    expect(counts.page).toBe(1);
    expect(counts.delta).toBe(0);
    expect(vi.mocked(moveToTrash)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(moveToTrash).mock.calls[0]?.[2]).toBe(fresh.sha1);
    expect(savedItems().find((item) => item.mediaKey === fresh.mediaKey)?.trashedAt).toBeDefined();
});

test('a stale index rename refreshes before changing the folder', async () => {
    const fresh = fileChunk(7, 0, 1, 'A');
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([fresh]);

    const result = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        fetcher
    );

    const value = result.unwrap();
    expect(value.fileCount).toBe(1);
    expect(value.revision).toBe(7);
    expect(counts.page).toBe(1);
    expect(savedItems().find((item) => item.mediaKey === fresh.mediaKey)?.folder).toBe('Renamed');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: 'Renamed' });
});

test('a stale index move-contents refreshes before clearing the folder prefix', async () => {
    const inside = fileChunk(7, 0, 1, 'A');
    const nested = fileChunk(8, 0, 1, 'A/sub');
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([inside, nested]);

    const result = await manageFolder(
        {
            action: FolderManageAction.MoveContents,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A'
        },
        fetcher
    );

    expect(result.unwrap().fileCount).toBe(2);
    expect(counts.page).toBe(1);
    expect(savedItems().find((item) => item.mediaKey === inside.mediaKey)?.folder).toBeUndefined();
    expect(savedItems().find((item) => item.mediaKey === nested.mediaKey)?.folder).toBe('sub');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: '' });
});

test('a stale index move refreshes before moving the folder', async () => {
    const inside = fileChunk(7, 0, 1, 'A');
    const anchor = fileChunk(8, 0, 1, 'B');
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([inside, anchor]);

    const result = await manageFolder(
        {
            action: FolderManageAction.Move,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            destination: 'B'
        },
        fetcher
    );

    expect(result.unwrap().fileCount).toBe(1);
    expect(counts.page).toBe(1);
    expect(savedItems().find((item) => item.mediaKey === inside.mediaKey)?.folder).toBe('B/A');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: 'B/A' });
});

test('a refreshed index that still lacks the folder keeps FOLDER_NOT_FOUND', async () => {
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([]);

    const result = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        fetcher
    );

    expect(result.unwrapErr().code).toBe('FOLDER_NOT_FOUND');
    expect(counts.page).toBe(1);
    expect(overrides().folderPrefixes).toEqual([]);
});

test('a freshly built index is not refreshed again', async () => {
    primeManageAuth();
    const { counts, fetcher } = pageFetcher([]);

    const result = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        fetcher
    );

    expect(result.unwrapErr().code).toBe('FOLDER_NOT_FOUND');
    expect(counts.page).toBe(1);
});

test('a refresh failure propagates without changing the folder', async () => {
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const { counts, fetcher } = pageFetcher([], 400);

    const result = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        fetcher
    );

    expect(result.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(counts.page).toBe(1);
    expect(readAccountState(MANAGE_EMAIL)?.items.size).toBe(1);
    expect(overrides().folderPrefixes).toEqual([]);
});

test('a refresh in one account does not mask another account failure', async () => {
    const first = 'first@example.com';
    const second = 'second@example.com';
    const stale = chunk(id('stale'), 'stale', { name: 'stale.bin' });
    saveItems([stale], 5, first);
    saveItems([stale], 5, second);

    const fresh = fileChunk(7, 0, 1, 'A');
    const firstPage = pageFetcher([fresh]);
    const recovered = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: first,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        firstPage.fetcher
    );

    expect(recovered.isOk()).toBe(true);
    expect(readAccountState(second)?.revision).toBe(5);
    expect(readAccountState(second)?.items.get('stale')).toEqual(stale);

    const secondPage = pageFetcher([]);
    const failed = await manageFolder(
        {
            action: FolderManageAction.Rename,
            email: second,
            token: MANAGE_TOKEN,
            folder: 'A',
            name: 'Renamed'
        },
        secondPage.fetcher
    );

    expect(failed.unwrapErr().code).toBe('FOLDER_NOT_FOUND');
});
