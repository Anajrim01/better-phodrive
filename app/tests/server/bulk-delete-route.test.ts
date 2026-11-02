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
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-route-'));
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

test('bulk delete streams one event per file and a done marker', async () => {
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    const body = payload(2);
    save(body);

    const response = await POST({ request: request(body) } as never);
    const events = parseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(events).toEqual([
        {
            type: 'file',
            index: 0,
            name: 'file-0.bin',
            action: FileActionKind.Delete,
            deleted: [{ mediaKey: 'media-0', sha1: SHA1, trashedAt: expect.any(Number) }]
        },
        {
            type: 'file',
            index: 1,
            name: 'file-1.bin',
            action: FileActionKind.Delete,
            deleted: [{ mediaKey: 'media-1', sha1: SHA1, trashedAt: expect.any(Number) }]
        },
        { type: 'done' }
    ]);
});

test('a failed provider batch still streams a per-file error', async () => {
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'REQUEST_FAILED',
                message: 'Delete failed',
                stage: 'Move to trash',
                status: 400
            } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Delete failed' } as const)
        )
    );
    const body = payload();
    save(body);

    const response = await POST({ request: request(body) } as never);
    const events = parseEvents(await response.text());

    expect(events[0]).toMatchObject({
        type: 'file',
        name: 'file-0.bin',
        action: FileActionKind.Delete,
        deleted: [],
        error: 'Delete failed'
    });
    expect(events.at(-1)).toEqual({ type: 'done' });
});

test('invalid bulk requests fail before streaming', async () => {
    const response = await POST({ request: request({}) } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request' });
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
