import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFile, deleteForeverFile, restoreFile } from '@madkarmaa/phodrive-core/server/files';
import {
    deletePermanently,
    moveToTrash,
    moveToTrashBatch,
    restoreFromTrash
} from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    flushLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
import { downloadFixture } from '../helpers/download';

// Mock the leaf modules rather than the photos barrel: the built core imports them
// directly, while source imports the barrel that re-exports these same functions.
vi.mock('@madkarmaa/phodrive-core/server/photos/trash', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/restore', () => ({
    restoreFromTrash: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/permanent-delete', () => ({
    deletePermanently: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
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
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(restoreFromTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(deletePermanently).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(ensureAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(refreshAccountIndex).mockImplementation(() =>
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

test('a 513-chunk trash action uses two bounded batches', async () => {
    const base = chunks()[0]!;
    const items = Array.from({ length: 513 }, (_, index) => ({
        ...base,
        chunkIndex: index,
        mediaKey: `chunk-${index}`,
        sha1: index.toString(16).padStart(40, '0')
    }));
    save(items);
    const { input } = downloadFixture();

    const result = await deleteFile({
        ...input,
        action: FileActionKind.Delete,
        chunks: items,
        workers: 1
    });

    const calls = vi.mocked(moveToTrashBatch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[2]).toHaveLength(500);
    expect(calls[1]?.[2]).toHaveLength(13);
    expect(result.unwrap().deleted).toHaveLength(513);
});

test('restoring clears the trashed mark and keeps the chunks', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1 }));
    save(items);
    const { input } = downloadFixture();

    const result = await restoreFile({
        ...input,
        action: FileActionKind.Restore,
        chunks: items
    });

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
        chunks: items.slice(0, 1)
    });

    const state = readAccountState(EMAIL);
    expect(result.unwrap().deleted.map((chunk) => chunk.mediaKey)).toEqual(['chunk-0']);
    expect(state?.items.has('chunk-0')).toBe(false);
    expect(state?.items.has('chunk-1')).toBe(true);
    expect(state?.revision).toBe(4);
    expect(state?.log.at(-1)?.deleted).toEqual(['chunk-0']);
});

test('restore and delete forever reject chunks that are not trashed', async () => {
    save(chunks());
    const { input } = downloadFixture();

    const restored = await restoreFile({ ...input, action: FileActionKind.Restore });
    const deleted = await deleteForeverFile({
        ...input,
        action: FileActionKind.DeleteForever
    });

    expect(restored.unwrapErr().code).toBe('NOT_TRASHED');
    expect(deleted.unwrapErr().code).toBe('NOT_TRASHED');
    expect(restoreFromTrash).not.toHaveBeenCalled();
    expect(deletePermanently).not.toHaveBeenCalled();
});

test('delete forever rejects a forged trashed state before any request', async () => {
    save(chunks());
    const { input } = downloadFixture();
    const forged = {
        ...input,
        action: FileActionKind.DeleteForever,
        chunks: input.chunks.map((chunk) => ({ ...chunk, trashedAt: 1 }))
    };

    const deleted = await deleteForeverFile(forged);

    expect(deleted.unwrapErr().code).toBe('NOT_TRASHED');
    expect(deletePermanently).not.toHaveBeenCalled();
});

test('delete forever rejects client chunk identity that differs from the account index', async () => {
    save(chunks().map((chunk) => ({ ...chunk, trashedAt: 1 })));
    const { input } = downloadFixture();
    const forged = {
        ...input,
        action: FileActionKind.DeleteForever,
        chunks: input.chunks.map((chunk) => ({
            ...chunk,
            mediaKey: `${chunk.mediaKey}-other`,
            trashedAt: 1
        }))
    };

    const deleted = await deleteForeverFile(forged);

    expect(deleted.unwrapErr().code).toBe('INVALID_FILE_METADATA');
    expect(deletePermanently).not.toHaveBeenCalled();
});

test('restore and delete forever send one key per sha1', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1, sha1: 'c'.repeat(40) }));
    save(items);
    const { input } = downloadFixture();

    await restoreFile({ ...input, action: FileActionKind.Restore, chunks: items });
    save(items);
    await deleteForeverFile({ ...input, action: FileActionKind.DeleteForever, chunks: items });

    expect(vi.mocked(restoreFromTrash).mock.calls[0]?.[2]).toEqual(['c'.repeat(40)]);
    expect(vi.mocked(deletePermanently).mock.calls[0]?.[2]).toEqual(['c'.repeat(40)]);
});

test('restore and delete forever keep earlier batches after a later failure', async () => {
    const base = chunks()[0]!;
    const items = Array.from({ length: 501 }, (_, index) => ({
        ...base,
        chunkIndex: index,
        mediaKey: `chunk-${index}`,
        sha1: index.toString(16).padStart(40, '0'),
        trashedAt: 1
    }));
    const failure = { code: 'REQUEST_FAILED', message: 'Later batch failed' } as const;

    save(items);
    const { input } = downloadFixture();
    vi.mocked(restoreFromTrash)
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Ok(undefined)))
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Err(failure)));

    const restored = await restoreFile({
        ...input,
        action: FileActionKind.Restore,
        chunks: items
    });

    expect(restored.unwrap().restored).toHaveLength(500);
    expect(restored.unwrap().error).toBe(failure.message);

    save(items);
    vi.mocked(deletePermanently)
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Ok(undefined)))
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Err(failure)));

    const deleted = await deleteForeverFile({
        ...input,
        action: FileActionKind.DeleteForever,
        chunks: items
    });

    expect(deleted.unwrap().deleted).toHaveLength(500);
    expect(deleted.unwrap().error).toBe(failure.message);
});

test('manual trash actions report retry wording for throttled requests', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1 }));
    save(items);
    const { input } = downloadFixture();
    vi.mocked(restoreFromTrash).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 5
            } as const)
        )
    );

    const result = await restoreFile(
        { ...input, action: FileActionKind.Restore, chunks: items },
        'manual'
    );

    expect(result.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        message: expect.stringContaining('try again')
    });
});

test('manual delete forever reports retry wording for throttled requests', async () => {
    const items = chunks().map((chunk) => ({ ...chunk, trashedAt: 1 }));
    save(items);
    const { input } = downloadFixture();
    vi.mocked(deletePermanently).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 5
            } as const)
        )
    );

    const result = await deleteForeverFile(
        { ...input, action: FileActionKind.DeleteForever, chunks: items },
        'manual'
    );

    expect(result.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        message: expect.stringContaining('try again')
    });
});

test('an empty trash action is rejected before any request', async () => {
    save(chunks());
    const { input } = downloadFixture();

    const restored = await restoreFile({
        ...input,
        action: FileActionKind.Restore,
        chunks: []
    });

    expect(restored.unwrapErr().code).toBe('INVALID_FILE_METADATA');
    expect(restoreFromTrash).not.toHaveBeenCalled();
});
