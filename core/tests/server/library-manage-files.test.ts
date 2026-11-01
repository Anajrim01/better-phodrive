import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { FileManageAction } from '@madkarmaa/phodrive-core/manage';
import { manageFile } from '@madkarmaa/phodrive-core/server/manage';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    MANAGE_EMAIL,
    MANAGE_TOKEN,
    chunk,
    id,
    overrides,
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
    expect(moved?.originalName).toBe('move.bin');
    expect(overrides().fileFolders[fileId]).toBe('B');
    expect(result.unwrap().revision).toBe(6);
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

test('management requires an indexed library first', async () => {
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
