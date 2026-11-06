import { afterEach, expect, test, vi } from 'vitest';
import { apiJson } from '../../src/browser/api';

afterEach(() => vi.unstubAllGlobals());

test('a 429 keeps its retry delay and status through the browser API', async () => {
    vi.stubGlobal('fetch', async () =>
        Response.json({ error: 'Wait.' }, { status: 429, headers: { 'retry-after': '17' } })
    );
    const response = await apiJson(
        '/api/public/shares/test/files/file/chunks/0',
        { method: 'POST' },
        'Failed.'
    );
    expect(response.unwrapErr()).toEqual({
        code: 'REQUEST_FAILED',
        message: 'Wait.',
        status: 429,
        retryAfterSeconds: 17
    });
});

test('other HTTP failures preserve status without inventing a retry delay', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Gone.' }, { status: 404 }));
    const response = await apiJson('/api/public/shares/test', { method: 'GET' }, 'Failed.');
    expect(response.unwrapErr()).toEqual({ code: 'REQUEST_FAILED', message: 'Gone.', status: 404 });
});
