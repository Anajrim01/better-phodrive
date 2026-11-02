import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import {
    clearLibraryState,
    configureLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { POST } from '../../src/routes/api/files/bulk/+server';
import { payload, parseEvents, request, save, savePartial, SHA1 } from '../helpers/bulk-route';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
}));

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-recovery-'));
    configureLibraryState(join(folder, 'library-state.json'));
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

test('a stale file in a mixed selection fails alone while valid files trash', async () => {
    const body = payload(2);
    save({ ...body, files: [body.files[0]] });
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );

    const response = await POST({ request: request(body) } as never);
    const events = parseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(events).toEqual([
        {
            type: 'file',
            index: 1,
            name: 'file-1.bin',
            action: FileActionKind.Delete,
            deleted: [],
            error: 'Invalid file metadata.'
        },
        {
            type: 'file',
            index: 0,
            name: 'file-0.bin',
            action: FileActionKind.Delete,
            deleted: [{ mediaKey: 'media-0', sha1: SHA1, trashedAt: expect.any(Number) }]
        },
        { type: 'done' }
    ]);
});

test('a refresh failure returns JSON and never calls trash', async () => {
    const body = payload();
    body.files[0][3].push(['media-1', createHash('sha1').update('second chunk').digest('hex')]);
    savePartial(body);
    vi.mocked(refreshAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Refresh failed' } as const)
        )
    );

    const response = await POST({ request: request(body) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Refresh failed' });
    expect(refreshAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test('a refresh that still misses a chunk returns validation JSON and never calls trash', async () => {
    const body = payload();
    body.files[0][3].push(['media-1', createHash('sha1').update('second chunk').digest('hex')]);
    savePartial(body);

    const response = await POST({ request: request(body) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid file metadata.' });
    expect(refreshAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).not.toHaveBeenCalled();
});

test.each([FileActionKind.Restore, FileActionKind.DeleteForever] as const)(
    'an all-invalid %s request returns the original NOT_TRASHED error',
    async (action) => {
        const body = payload(1, action);
        save(body);

        const response = await POST({ request: request(body) } as never);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'Only trashed chunks can be restored or deleted forever.'
        });
        expect(refreshAccountIndex).toHaveBeenCalledOnce();
        expect(moveToTrashBatch).not.toHaveBeenCalled();
    }
);
