import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFile, deleteForeverFile, restoreFile } from '@madkarmaa/phodrive-core/server/files';
import {
    deletePermanently,
    moveToTrash,
    restoreFromTrash
} from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    flushLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn(),
    restoreFromTrash: vi.fn(),
    deletePermanently: vi.fn()
}));

const EMAIL = 'test@example.com';
let folder = '';
let statePath = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-trash-actions-'));
    statePath = join(folder, 'library-state.json');
    clearLibraryState();
    configureLibraryState(statePath);
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(restoreFromTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(deletePermanently).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

function chunks(): RemoteBmp[] {
    return downloadFixture().input.chunks;
}

function save(items: RemoteBmp[], revision = 3): void {
    writeAccountState(EMAIL, {
        syncToken: Buffer.from('sync-one'),
        revision,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });
}

test('moving to trash marks chunks immediately and keeps them in the index', async () => {
    const items = chunks();
    save(items);
    const { input } = downloadFixture();

    const result = await deleteFile({ ...input, action: FileActionKind.Delete, workers: 1 });

    const deleted = result.unwrap().deleted;
    const state = readAccountState(EMAIL);
    expect(deleted.every((chunk) => chunk.trashedAt !== undefined)).toBe(true);
    expect(state?.items.size).toBe(2);
    expect(state?.items.get('chunk-0')?.trashedAt).toEqual(expect.any(Number));
    expect(state?.revision).toBe(4);
    expect(state?.log.at(-1)?.items).toHaveLength(2);

    flushLibraryState();
    clearLibraryState();
    configureLibraryState(statePath);
    expect(readAccountState(EMAIL)?.items.get('chunk-0')?.trashedAt).toEqual(expect.any(Number));
});

test('restoring clears the trashed mark and keeps the chunks', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1 }));
    save(items);
    const { input } = downloadFixture();

    const result = await restoreFile({ ...input, action: FileActionKind.Restore });

    const state = readAccountState(EMAIL);
    expect(result.unwrap().restored).toHaveLength(2);
    expect(result.unwrap().restored[0]?.trashedAt).toBeUndefined();
    expect(state?.items.size).toBe(2);
    expect(state?.items.get('chunk-0')?.trashedAt).toBeUndefined();
    expect(state?.revision).toBe(4);
    expect(state?.log.at(-1)?.items).toHaveLength(2);
});

test('permanent deletion removes the selected chunks from the index', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1 }));
    save(items);
    const { input } = downloadFixture();

    const result = await deleteForeverFile({
        ...input,
        action: FileActionKind.DeleteForever,
        chunks: input.chunks.slice(0, 1)
    });

    const state = readAccountState(EMAIL);
    expect(result.unwrap().deleted.map((chunk) => chunk.mediaKey)).toEqual(['chunk-0']);
    expect(state?.items.has('chunk-0')).toBe(false);
    expect(state?.items.has('chunk-1')).toBe(true);
    expect(state?.revision).toBe(4);
    expect(state?.log.at(-1)?.deleted).toEqual(['chunk-0']);
});
