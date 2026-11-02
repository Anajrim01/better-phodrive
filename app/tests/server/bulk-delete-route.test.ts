import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { createHash } from 'node:crypto';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import { POST } from '../../src/routes/api/files/bulk/+server';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

const SHA1 = createHash('sha1').update('bulk route').digest('hex');

function payload(files = 1) {
    return {
        email: 'test@example.com',
        token: 'aas_et/test',
        workers: 2,
        files: Array.from({ length: files }, (_, index) => ({
            name: `file-${index}.bin`,
            chunks: [{ mediaKey: `media-${index}`, sha1: SHA1 }]
        }))
    };
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

    const response = await POST({ request: request(payload(2)) } as never);
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

    const response = await POST({ request: request(payload()) } as never);
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
