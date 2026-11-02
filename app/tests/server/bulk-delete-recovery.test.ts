import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    ensureAccountIndex,
    refreshAccountIndex
} from '@madkarmaa/phodrive-core/server/photos/library/ensure';
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

function ok() {
    return Ok(undefined).andThenAsync(async () => Ok(undefined));
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-recovery-'));
    configureLibraryState(join(folder, 'library-state.json'));
    vi.mocked(ensureAccountIndex).mockImplementation(() => ok());
    vi.mocked(refreshAccountIndex).mockImplementation(() => ok());
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});

test('missing state is built before streaming and before trash', async () => {
    const body = payload();
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    vi.mocked(ensureAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            order.push('ensure:start');
            await gate;
            save(body);
            order.push('ensure:end');

            return Ok(undefined);
        })
    );
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            order.push('trash');

            return Ok(undefined);
        })
    );

    let settled = false;
    const pending = Promise.resolve(POST({ request: request(body) } as never)).then((response) => {
        settled = true;

        return response;
    });

    await vi.waitFor(() => expect(order).toEqual(['ensure:start']));
    expect(settled).toBe(false);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
    release();
    const response = await pending;
    const events = parseEvents(await response.text());

    expect(order).toEqual(['ensure:start', 'ensure:end', 'trash']);
    expect(ensureAccountIndex).toHaveBeenCalledOnce();
    expect(refreshAccountIndex).not.toHaveBeenCalled();
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: 'done' });
});

test('stale state refreshes once before streaming and is not refreshed again', async () => {
    const body = payload();
    const secondSha1 = createHash('sha1').update('second chunk').digest('hex');
    body.files[0][3].push(['media-1', secondSha1]);
    savePartial(body);
    const order: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    vi.mocked(refreshAccountIndex).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            order.push('refresh:start');
            await gate;
            save(body);
            order.push('refresh:end');

            return Ok(undefined);
        })
    );
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            order.push('trash');

            return Ok(undefined);
        })
    );

    let settled = false;
    const pending = Promise.resolve(POST({ request: request(body) } as never)).then((response) => {
        settled = true;

        return response;
    });

    await vi.waitFor(() => expect(order).toEqual(['refresh:start']));
    expect(settled).toBe(false);
    expect(moveToTrashBatch).not.toHaveBeenCalled();
    release();
    const response = await pending;
    const events = parseEvents(await response.text());

    expect(order).toEqual(['refresh:start', 'refresh:end', 'trash']);
    expect(ensureAccountIndex).not.toHaveBeenCalled();
    expect(refreshAccountIndex).toHaveBeenCalledOnce();
    expect(moveToTrashBatch).toHaveBeenCalledOnce();
    expect(events.at(-1)).toEqual({ type: 'done' });
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
            deleted: [],
            error: 'Invalid file metadata.'
        },
        {
            type: 'file',
            index: 0,
            name: 'file-0.bin',
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
