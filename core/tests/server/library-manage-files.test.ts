import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { FileManageAction } from '@madkarmaa/phodrive-core/manage';
import { RemoteBmpSchema } from '@madkarmaa/phodrive-core/models';
import { manageFile } from '@madkarmaa/phodrive-core/server/manage';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { syncLibrary } from '@madkarmaa/phodrive-core/server/photos/library/sync';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    SYNC_ONE,
    SYNC_TWO,
    emptyCounts,
    fetcherFor,
    fileChunk,
    pageBytes
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

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-manage-files-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    await rm(folder, { recursive: true, force: true });
});

test('renaming a file keeps every chunk and duplicate together', async () => {
    const fileId = id('one');
    saveItems([
        chunk(fileId, 'chunk-0', { name: 'old.bin', index: 0, last: false }),
        chunk(fileId, 'chunk-1', { index: 1 }),
        chunk(fileId, 'duplicate-0', { name: 'old.bin' })
    ]);

    const result = await manageFile({
        action: FileManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        name: 'new.bin'
    });

    expect(result.unwrap().items).toHaveLength(3);
    expect(savedItems().every((item) => item.originalName === 'new.bin')).toBe(true);
    expect(savedItems().find((item) => item.mediaKey === 'chunk-0')?.sourceName).toBe('old.bin');
    expect(savedItems().find((item) => item.mediaKey === 'chunk-1')?.sourceName).toBeUndefined();
    expect(overrides().fileNames[fileId]).toBe('new.bin');
});

test('moving a file keeps its chunk identity and listing folder', async () => {
    const fileId = id('move-file');
    saveItems([
        chunk(fileId, 'move-file', { name: 'move.bin', folder: 'A' }),
        chunk(id('target'), 'target', { name: 'target.bin', folder: 'B' })
    ]);

    const result = await manageFile({
        action: FileManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        folder: 'B'
    });

    const moved = savedItems().find((item) => item.fileId === fileId);
    expect(moved?.folder).toBe('B');
    expect(moved?.fileHash).toBe(fileId);
    expect(moved && RemoteBmpSchema.safeParse(moved).success).toBe(true);
    expect(moved?.originalName).toBe('move.bin');
    expect(overrides().fileFolders[fileId]).toBe('B');
    expect(result.unwrap().revision).toBe(6);
});

test('a stale index is refreshed when a move names a client-visible file', async () => {
    const sourceFolder = 'Docs';
    const name = 'file-7.bin';
    const fileHash = createHash('sha256').update('file-7').digest('hex');
    const fileId = fileIdentity(name, fileHash, undefined, sourceFolder);
    const fresh = fileChunk(7, 0, 1, sourceFolder);
    const anchor = fileChunk(8, 0, 1, 'Parent');
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const counts = emptyCounts();
    const fetcher = fetcherFor(
        [fresh, anchor],
        [pageBytes([fresh, anchor], '', { syncToken: SYNC_ONE })],
        counts,
        { delta: pageBytes([], '', { syncToken: SYNC_ONE }) }
    );

    const result = await manageFile(
        {
            action: FileManageAction.Move,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            fileId,
            folder: 'Parent'
        },
        fetcher
    );

    expect(counts.page).toBe(1);
    expect(result.unwrap().revision).toBe(0);
    expect(result.unwrap().items.some((item) => item.fileId === fileId)).toBe(true);
    expect(savedItems().find((item) => item.fileId === fileId)?.folder).toBe('Parent');
});

test('a recovered same-folder move does not advance the client cursor', async () => {
    const folder = 'Docs';
    const name = 'file-7.bin';
    const fileHash = createHash('sha256').update('file-7').digest('hex');
    const fileId = fileIdentity(name, fileHash, undefined, folder);
    const target = fileChunk(7, 0, 1, folder);
    const unseen = fileChunk(9, 0, 1, 'Other');
    saveItems([chunk(id('old'), 'old', { name: 'old.bin' })], 5);
    const counts = emptyCounts();
    const fetcher = fetcherFor(
        [target, unseen],
        [pageBytes([target, unseen], '', { syncToken: SYNC_ONE })],
        counts,
        { delta: pageBytes([], '', { syncToken: SYNC_TWO }) }
    );

    const moved = await manageFile(
        {
            action: FileManageAction.Move,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            fileId,
            folder
        },
        fetcher
    );
    const response = moved.unwrap();

    expect(counts.page).toBe(1);
    expect(response.items).toEqual([]);
    expect(response.revision).toBe(0);

    const synced = await syncLibrary(MANAGE_EMAIL, MANAGE_TOKEN, false, 5, fetcher);

    expect(synced.unwrap().items.some((item) => item.mediaKey === unseen.mediaKey)).toBe(true);
});

test('a file missing from a refreshed index is still rejected', async () => {
    saveItems([chunk(id('stale'), 'stale', { name: 'stale.bin' })]);
    const counts = emptyCounts();
    const fetcher = fetcherFor([], [pageBytes([], '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_ONE })
    });

    const result = await manageFile(
        {
            action: FileManageAction.Move,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            fileId: id('missing'),
            folder: ''
        },
        fetcher
    );

    expect(counts.page).toBe(1);
    expect(result.unwrapErr().code).toBe('FILE_NOT_FOUND');
});

test('moving a file to My files omits the folder field', async () => {
    const fileId = id('root-file');
    saveItems([chunk(fileId, 'root-file', { name: 'root.bin', folder: 'A' })]);

    await manageFile({
        action: FileManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        folder: ''
    });

    const moved = savedItems()[0];
    expect(moved?.folder).toBeUndefined();
    expect(moved?.sourceFolder).toBe('A');
    expect(moved && RemoteBmpSchema.safeParse(moved).success).toBe(true);
});

test('file rename and move collisions are rejected without changing state', async () => {
    const first = id('first');
    const inFirstFolder = id('in-first-folder');
    const inDestination = id('in-destination');
    saveItems([
        chunk(first, 'first', { name: 'first.bin', folder: 'A' }),
        chunk(inFirstFolder, 'in-first-folder', { name: 'taken.bin', folder: 'A' }),
        chunk(inDestination, 'in-destination', { name: 'taken.bin', folder: 'B' }),
        chunk(id('destination-first'), 'destination-first', {
            name: 'first.bin',
            folder: 'B'
        })
    ]);

    const rename = await manageFile({
        action: FileManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId: first,
        name: 'taken.bin'
    });
    expect(rename.unwrapErr().code).toBe('FILE_NAME_EXISTS');

    const move = await manageFile({
        action: FileManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId: first,
        folder: 'B'
    });
    expect(move.unwrapErr().code).toBe('FILE_NAME_EXISTS');
    expect(savedItems().find((item) => item.fileId === first)?.folder).toBe('A');
});

test('moving a file to an unknown folder is rejected', async () => {
    const fileId = id('unknown');
    saveItems([chunk(fileId, 'unknown', { name: 'file.bin', folder: 'A' })]);

    const result = await manageFile({
        action: FileManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        fileId,
        folder: 'Missing'
    });

    expect(result.unwrapErr().code).toBe('INVALID_FOLDER_DESTINATION');
});

test('a cached index still requires a valid token', async () => {
    const fileId = id('auth');
    saveItems([chunk(fileId, 'auth', { name: 'auth.bin', folder: 'A' })]);

    const result = await manageFile(
        {
            action: FileManageAction.Rename,
            email: MANAGE_EMAIL,
            token: 'aas_et/wrong',
            fileId,
            name: 'renamed.bin'
        },
        async () => new Response(null, { status: 401 })
    );

    expect(result.isErr()).toBe(true);
    expect(savedItems()[0]?.originalName).toBe('auth.bin');
});

test('management requires an indexed library first', async () => {
    primeManageAuth();
    const result = await manageFile(
        {
            action: FileManageAction.Rename,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            fileId: id('missing'),
            name: 'name.bin'
        },
        async () => new Response(null, { status: 500 })
    );

    expect(result.isErr()).toBe(true);
});
