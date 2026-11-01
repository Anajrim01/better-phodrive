import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { FolderManageAction } from '@madkarmaa/phodrive-core/manage';
import { RemoteBmpSchema } from '@madkarmaa/phodrive-core/models';
import { manageFolder } from '@madkarmaa/phodrive-core/server/folders';
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
    overrides,
    saveItems,
    savedItems
} from '../helpers/manage';

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-manage-folders-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    await rm(folder, { recursive: true, force: true });
});

test('renaming a folder changes every nested path prefix', async () => {
    const loose = id('loose');
    const nested = id('nested');
    const other = id('other');
    saveItems([
        chunk(loose, 'loose', { name: 'loose.bin', folder: 'A' }),
        chunk(nested, 'nested', { name: 'nested.bin', folder: 'A/sub' }),
        chunk(other, 'other', { name: 'other.bin', folder: 'B' })
    ]);

    const result = await manageFolder({
        action: FolderManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        name: 'Renamed'
    });

    expect(result.unwrap().fileCount).toBe(2);
    const items = savedItems();
    expect(items.find((item) => item.fileId === loose)?.folder).toBe('Renamed');
    expect(items.find((item) => item.fileId === loose)?.sourceFolder).toBe('A');
    expect(items.find((item) => item.fileId === nested)?.folder).toBe('Renamed/sub');
    expect(items.find((item) => item.fileId === nested)?.sourceFolder).toBe('A/sub');
    expect(items.find((item) => item.fileId === other)?.folder).toBe('B');
    expect(overrides().fileFolders[loose]).toBe('Renamed');
    expect(overrides().fileFolders[nested]).toBe('Renamed/sub');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: 'Renamed' });
});

test('moving a folder into another folder keeps its name and subtree', async () => {
    const direct = id('direct');
    const nested = id('nested');
    saveItems([
        chunk(direct, 'direct', { name: 'direct.bin', folder: 'A' }),
        chunk(nested, 'nested', { name: 'nested.bin', folder: 'A/sub' }),
        chunk(id('destination'), 'destination', { name: 'destination.bin', folder: 'B' })
    ]);

    const result = await manageFolder({
        action: FolderManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        destination: 'B'
    });

    expect(result.unwrap().fileCount).toBe(2);
    expect(savedItems().find((item) => item.fileId === direct)?.folder).toBe('B/A');
    expect(savedItems().find((item) => item.fileId === nested)?.folder).toBe('B/A/sub');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: 'B/A' });
});

test('moving folder contents to My files clears only the folder prefix', async () => {
    const direct = id('direct');
    const nested = id('nested');
    saveItems([
        chunk(direct, 'direct', { name: 'direct.bin', folder: 'A' }),
        chunk(nested, 'nested', { name: 'nested.bin', folder: 'A/sub' })
    ]);

    const result = await manageFolder({
        action: FolderManageAction.MoveContents,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A'
    });

    expect(result.unwrap().fileCount).toBe(2);
    const directItem = savedItems().find((item) => item.fileId === direct);
    expect(directItem?.folder).toBeUndefined();
    expect(directItem && RemoteBmpSchema.safeParse(directItem).success).toBe(true);
    expect(savedItems().find((item) => item.fileId === nested)?.folder).toBe('sub');
    expect(overrides().fileFolders[direct]).toBe('');
    expect(overrides().folderPrefixes).toContainEqual({ from: 'A', to: '' });
});

test('folder collisions and moving a folder into itself are rejected', async () => {
    saveItems([
        chunk(id('first'), 'first', { name: 'first.bin', folder: 'A' }),
        chunk(id('folder'), 'folder', { name: 'folder.bin', folder: 'Existing' })
    ]);

    const rename = await manageFolder({
        action: FolderManageAction.Rename,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        name: 'Existing'
    });
    expect(rename.unwrapErr().code).toBe('FOLDER_EXISTS');

    const inside = await manageFolder({
        action: FolderManageAction.Move,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A',
        destination: 'A'
    });
    expect(inside.unwrapErr().code).toBe('INVALID_FOLDER_DESTINATION');
    expect(readAccountState(MANAGE_EMAIL)?.revision).toBe(5);
});

test('moving folder contents onto an existing root name is rejected atomically', async () => {
    saveItems([
        chunk(id('inside'), 'inside', { name: 'same.bin', folder: 'A/sub' }),
        chunk(id('outside'), 'outside', { name: 'same.bin', folder: 'sub' })
    ]);

    const result = await manageFolder({
        action: FolderManageAction.MoveContents,
        email: MANAGE_EMAIL,
        token: MANAGE_TOKEN,
        folder: 'A'
    });

    expect(result.unwrapErr().code).toBe('FILE_NAME_EXISTS');
    expect(overrides().folderPrefixes).toEqual([]);
    expect(readAccountState(MANAGE_EMAIL)?.revision).toBe(5);
});
