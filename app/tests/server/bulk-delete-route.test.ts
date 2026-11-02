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
import type { BulkDeleteRequest } from '@madkarmaa/phodrive-core/bulk-delete';
import {
    clearLibraryState,
    configureLibraryState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { POST } from '../../src/routes/api/files/bulk/+server';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/server/photos/library/ensure', () => ({
    ensureAccountIndex: vi.fn(),
    refreshAccountIndex: vi.fn()
}));

const EMAIL = 'test@example.com';
const SHA1 = createHash('sha1').update('bulk route').digest('hex');
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

function payload(files = 1): BulkDeleteRequest {
    return {
        email: EMAIL,
        token: 'aas_et/test',
        workers: 2,
        files: Array.from({ length: files }, (_, index) => {
            const name = `file-${index}.bin`;
            const hash = createHash('sha256').update(name).digest('hex');

            return [
                name,
                hash,
                hash,
                [[`media-${index}`, SHA1]]
            ] as BulkDeleteRequest['files'][number];
        })
    };
}

function save(body: BulkDeleteRequest, limit?: number): void {
    const items = body.files.flatMap(([, fileHash, fileId, chunks]) =>
        chunks.slice(0, limit).map(([mediaKey, sha1]) => ({
            fileHash,
            fileId,
            chunkIndex: 0,
            isLast: true,
            size: 1,
            at: 1,
            mediaKey,
            sha1
        }))
    );
    writeAccountState(EMAIL, {
        syncToken: Buffer.from('sync'),
        revision: 1,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });
}

function savePartial(body: BulkDeleteRequest): void {
    save(body, 1);
}

function request(body: unknown): Request {
    return new Request('http://localhost/api/files/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

function parseEvents(text: string): unknown[] {
    return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
}

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
            deleted: [{ mediaKey: 'media-0', sha1: SHA1, trashedAt: expect.any(Number) }]
        },
        {
            type: 'file',
            index: 1,
            name: 'file-1.bin',
            deleted: [{ mediaKey: 'media-1', sha1: SHA1, trashedAt: expect.any(Number) }]
        },
        { type: 'done' }
    ]);
});

test('a failed provider batch still streams a per-file error', async () => {
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Delete failed', status: 400 } as const)
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

    const pending = POST({ request: request(body) } as never);

    await vi.waitFor(() => expect(order).toEqual(['ensure:start']));
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

test('stale state refreshes once before streaming and deleteFiles does not refresh again', async () => {
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

    const pending = POST({ request: request(body) } as never);

    await vi.waitFor(() => expect(order).toEqual(['refresh:start']));
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
