import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { FileManageAction } from '@madkarmaa/phodrive-core/manage';
import { manageFile } from '@madkarmaa/phodrive-core/server/manage';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos/library';
import { syncLibrary } from '@madkarmaa/phodrive-core/server/photos/library/sync';
import {
    clearLibraryState,
    configureLibraryState,
    flushLibraryState,
    readAccountOverrides,
    readAccountState,
    removeChunks,
    writeAccountOverrides
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    SYNC_ONE,
    SYNC_TWO,
    chunkItem,
    emptyCounts,
    fetcherFor,
    pageBytes
} from '../helpers/delta-library';
import { MANAGE_EMAIL, MANAGE_TOKEN, chunk, id, saveItems } from '../helpers/manage';

let folder = '';

function baseIdentity() {
    const base = chunkItem(0);
    const fileHash = createHash('sha256').update('file-0').digest('hex');

    return { base, fileId: fileIdentity('file-0.bin', fileHash) };
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-manage-overrides-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    await rm(folder, { recursive: true, force: true });
});

test('a full sync reapplies persisted renames and moves', async () => {
    const { base, fileId } = baseIdentity();
    writeAccountOverrides(MANAGE_EMAIL, {
        fileNames: { [fileId]: 'renamed.bin' },
        fileFolders: { [fileId]: 'Moved' },
        folderPrefixes: []
    });
    const counts = emptyCounts();
    const fetcher = fetcherFor([base], [pageBytes([base], '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const synced = await syncLibrary(MANAGE_EMAIL, MANAGE_TOKEN, true, 0, fetcher);

    expect(synced.unwrap().items[0]).toMatchObject({
        originalName: 'renamed.bin',
        folder: 'Moved'
    });
    expect([...(readAccountState(MANAGE_EMAIL)?.items.values() ?? [])][0]).toMatchObject({
        originalName: 'renamed.bin',
        folder: 'Moved'
    });
});

test('listing applies persisted renames and moves to live pages', async () => {
    const { base, fileId } = baseIdentity();
    writeAccountOverrides(MANAGE_EMAIL, {
        fileNames: { [fileId]: 'renamed.bin' },
        fileFolders: { [fileId]: 'Moved' },
        folderPrefixes: []
    });
    const counts = emptyCounts();
    const fetcher = fetcherFor([base], [pageBytes([base], '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const page = await listBmps(MANAGE_EMAIL, MANAGE_TOKEN, '', fetcher);

    expect(page.unwrap().items[0]).toMatchObject({
        originalName: 'renamed.bin',
        folder: 'Moved'
    });
});

test('delta items receive persisted renames and moves', async () => {
    const { base, fileId } = baseIdentity();
    saveItems([], 5);
    writeAccountOverrides(MANAGE_EMAIL, {
        fileNames: { [fileId]: 'renamed.bin' },
        fileFolders: { [fileId]: 'Moved' },
        folderPrefixes: []
    });
    const counts = emptyCounts();
    const fetcher = fetcherFor([base], [], counts, {
        delta: pageBytes([base], '', { syncToken: SYNC_TWO })
    });

    const synced = await syncLibrary(MANAGE_EMAIL, MANAGE_TOKEN, false, 5, fetcher);

    expect(synced.unwrap().items[0]).toMatchObject({
        originalName: 'renamed.bin',
        folder: 'Moved'
    });
});

test('overrides survive a state flush and reload', async () => {
    const fileId = id('persist');
    writeAccountOverrides(MANAGE_EMAIL, {
        fileNames: { [fileId]: 'persisted.bin' },
        fileFolders: { [fileId]: 'Stored' },
        folderPrefixes: [{ from: 'Old', to: 'Stored' }]
    });
    flushLibraryState();
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));

    expect(readAccountOverrides(MANAGE_EMAIL)).toEqual({
        fileNames: { [fileId]: 'persisted.bin' },
        fileFolders: { [fileId]: 'Stored' },
        folderPrefixes: [{ from: 'Old', to: 'Stored' }]
    });
});

test('permanent deletion forgets a file name and folder override', () => {
    const fileId = id('deleted');
    saveItems([
        chunk(fileId, 'deleted-0', { name: 'gone.bin', folder: 'A', last: false }),
        chunk(fileId, 'deleted-1', { index: 1 })
    ]);
    writeAccountOverrides(MANAGE_EMAIL, {
        fileNames: { [fileId]: 'renamed.bin' },
        fileFolders: { [fileId]: 'B' },
        folderPrefixes: [{ from: 'A', to: 'B' }]
    });

    removeChunks(MANAGE_EMAIL, [{ mediaKey: 'deleted-0' }, { mediaKey: 'deleted-1' }]);

    expect(readAccountOverrides(MANAGE_EMAIL).fileNames).toEqual({});
    expect(readAccountOverrides(MANAGE_EMAIL).fileFolders).toEqual({});
    expect(readAccountOverrides(MANAGE_EMAIL).folderPrefixes).toEqual([{ from: 'A', to: 'B' }]);
});

test('the change log gives another client the renamed item', async () => {
    const fileId = id('log');
    saveItems([chunk(fileId, 'log', { name: 'before.bin', folder: 'A' })], 5);
    await manageFile({
        action: FileManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        name: 'after.bin'
    });
    const counts = emptyCounts();
    const fetcher = fetcherFor([], [], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const synced = await syncLibrary(MANAGE_EMAIL, MANAGE_TOKEN, false, 5, fetcher);

    expect(synced.unwrap()).toMatchObject({ full: false, revision: 6 });
    expect(synced.unwrap().items[0]).toMatchObject({
        mediaKey: 'log',
        originalName: 'after.bin'
    });
});

test('revision and change log advance with a batch of folder items', () => {
    const fileId = id('revision');
    saveItems([
        chunk(fileId, 'revision-0', { name: 'revision.bin', folder: 'A', last: false }),
        chunk(fileId, 'revision-1', { index: 1 })
    ]);

    return manageFile({
        action: FileManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        name: 'new.bin'
    }).then(() => {
        const state = readAccountState(MANAGE_EMAIL);
        expect(state?.revision).toBe(6);
        expect(state?.log.at(-1)).toMatchObject({ revision: 6 });
        expect(state?.log.at(-1)?.items).toHaveLength(2);
    });
});
