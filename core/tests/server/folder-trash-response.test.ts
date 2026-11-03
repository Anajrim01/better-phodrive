import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FolderManageAction } from '@madkarmaa/phodrive-core/manage';
import { manageFolder } from '@madkarmaa/phodrive-core/server/folders';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    CAPTURED_ALREADY_TRASHED,
    CAPTURED_ALREADY_TRASHED_KEY,
    CAPTURED_DELETE_KEY,
    CAPTURED_DELETE_SUCCESS
} from '../helpers/delete-response';
import { MANAGE_EMAIL, MANAGE_TOKEN, chunk, id, saveItems, savedItems } from '../helpers/manage';

const FOLDER = 'M3QRoot-EU-source';
let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-folder-trash-response-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

function deleteFolder(fetcher: Fetcher) {
    return manageFolder(
        {
            action: FolderManageAction.Delete,
            email: MANAGE_EMAIL,
            token: MANAGE_TOKEN,
            folder: FOLDER,
            workers: 1
        },
        fetcher
    );
}

test('a multi-chunk folder delete accepts an already-trashed chunk', async () => {
    const file = id('target.h');
    saveItems([
        chunk(file, CAPTURED_DELETE_KEY, {
            name: 'target.h',
            folder: FOLDER,
            index: 0,
            last: false
        }),
        chunk(file, CAPTURED_ALREADY_TRASHED_KEY, { name: 'target.h', folder: FOLDER, index: 1 })
    ]);
    let trashCalls = 0;
    const fetcher: Fetcher = async () => {
        trashCalls++;

        return new Response(trashCalls === 1 ? CAPTURED_DELETE_SUCCESS : CAPTURED_ALREADY_TRASHED);
    };

    const result = await deleteFolder(fetcher);

    const value = result.unwrap();
    expect(trashCalls).toBe(2);
    expect(value.fileCount).toBe(1);
    expect(value.failed).toEqual([]);
    expect(value.items).toHaveLength(2);
    expect(savedItems().every((item) => item.trashedAt !== undefined)).toBe(true);
});

test('a duplicate-sha1 folder delete rejects an already-trashed response for another media key', async () => {
    const file = id('duplicate.h');
    const first = chunk(file, CAPTURED_DELETE_KEY, {
        name: 'duplicate.h',
        folder: FOLDER,
        index: 0,
        last: false
    });
    const second = chunk(file, 'second-chunk-key', {
        name: 'duplicate.h',
        folder: FOLDER,
        index: 1
    });
    saveItems([first, { ...second, sha1: first.sha1 }]);
    let trashCalls = 0;
    const fetcher: Fetcher = async () => {
        trashCalls++;

        return new Response(trashCalls === 1 ? CAPTURED_DELETE_SUCCESS : CAPTURED_ALREADY_TRASHED);
    };

    const result = await deleteFolder(fetcher);

    const value = result.unwrap();
    expect(trashCalls).toBe(2);
    expect(value.fileCount).toBe(1);
    expect(value.failed).toHaveLength(1);
    expect(value.failed[0]?.fileId).toBe(file);
    expect(value.failed[0]?.message).toBe('Invalid delete response.');
    expect(value.items).toHaveLength(1);

    const items = savedItems();
    expect(items.find((item) => item.mediaKey === CAPTURED_DELETE_KEY)?.trashedAt).toBeTypeOf(
        'number'
    );
    expect(items.find((item) => item.mediaKey === 'second-chunk-key')?.trashedAt).toBeUndefined();
});

test('a malformed folder delete response still fails and keeps the file active', async () => {
    const file = id('target.h');
    saveItems([chunk(file, CAPTURED_DELETE_KEY, { name: 'target.h', folder: FOLDER })]);
    const fetcher: Fetcher = async () => new Response('malformed');

    const result = await deleteFolder(fetcher);

    const value = result.unwrap();
    expect(value.failed).toHaveLength(1);
    expect(value.failed[0]?.message).toBe('Invalid delete response.');
    expect(savedItems().every((item) => item.trashedAt === undefined)).toBe(true);
});
