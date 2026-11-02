import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
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

const EMAIL = 'test@example.com';
const SHA1 = createHash('sha1').update('bulk route').digest('hex');
let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-route-'));
    configureLibraryState(join(folder, 'library-state.json'));
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

function save(body: BulkDeleteRequest): void {
    const items = body.files.flatMap(([, fileHash, fileId, chunks]) =>
        chunks.map(([mediaKey, sha1]) => ({
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
