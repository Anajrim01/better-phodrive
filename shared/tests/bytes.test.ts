import { describe, expect, it } from 'vitest';
import { createBytesHandler } from '../functions/_lib/bytes';
import { MAX_RANGE_BYTES } from '../functions/_lib/limits';

const MEDIA_URL = 'https://lh3.googleusercontent.com/pw/token-one-abcdefghijklmnop';

interface Call {
    url: string;
    range: string | null;
}

function request(url: string, range?: string): Request {
    return new Request('https://shared.phodrive.dev/api/bytes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(range ? { url, range } : { url })
    });
}

function fetchReturning(calls: Call[], response: () => Response): typeof fetch {
    return async (input, init) => {
        calls.push({
            url: String(input),
            range: new Headers(init?.headers).get('range')
        });

        return response();
    };
}

describe('POST /api/bytes', () => {
    it('forwards a range and passes length and content range', async () => {
        const calls: Call[] = [];
        const handler = createBytesHandler({
            fetch: fetchReturning(
                calls,
                () =>
                    new Response(new Uint8Array([1, 2, 3, 4]), {
                        status: 206,
                        headers: {
                            'content-length': '4',
                            'content-range': 'bytes 0-3/100',
                            'accept-ranges': 'bytes'
                        }
                    })
            )
        });
        const response = await handler(request(MEDIA_URL, 'bytes=0-3'));

        expect(response.status).toBe(206);
        expect(calls[0].range).toBe('bytes=0-3');
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect(response.headers.get('content-disposition')).toContain('attachment');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-length')).toBe('4');
        expect(response.headers.get('content-range')).toBe('bytes 0-3/100');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('rejects a non Google host without fetching it', async () => {
        const calls: Call[] = [];
        const handler = createBytesHandler({ fetch: fetchReturning(calls, () => new Response()) });
        const response = await handler(request('https://evil.example/pw/token'));

        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_BYTES_URL');
        expect(calls).toHaveLength(0);
    });

    it('rejects paths outside the allowlist', async () => {
        const calls: Call[] = [];
        const handler = createBytesHandler({ fetch: fetchReturning(calls, () => new Response()) });

        for (const url of [
            'https://lh3.googleusercontent.com/pw/token-abcdefghijklmnop/extra',
            'https://lh3.googleusercontent.com/pw/token-abcdefghijklmnop?x=1',
            'https://lh3.googleusercontent.com/avatar'
        ]) {
            const response = await handler(request(url));
            expect(response.status).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });

    it('refuses cross host redirects', async () => {
        const calls: Call[] = [];
        const handler = createBytesHandler({
            fetch: fetchReturning(
                calls,
                () =>
                    new Response(null, {
                        status: 302,
                        headers: { location: 'https://evil.example/file' }
                    })
            )
        });
        const response = await handler(request(MEDIA_URL));

        expect(response.status).toBe(502);
        expect((await response.json()).error.code).toBe('UPSTREAM_REDIRECT');
    });

    it('rejects multiple and oversized ranges', async () => {
        const calls: Call[] = [];
        const handler = createBytesHandler({ fetch: fetchReturning(calls, () => new Response()) });

        for (const range of [
            'bytes=0-1,4-5',
            `bytes=0-${MAX_RANGE_BYTES}`,
            'bytes=10-5',
            'items=0-1'
        ]) {
            const response = await handler(request(MEDIA_URL, range));
            expect(response.status).toBe(400);
            expect((await response.json()).error.code).toBe('INVALID_RANGE');
        }
        expect(calls).toHaveLength(0);
    });

    it('rejects a partial response when no range was requested', async () => {
        const handler = createBytesHandler({
            fetch: fetchReturning([], () => new Response(new Uint8Array([1]), { status: 206 }))
        });
        const response = await handler(request(MEDIA_URL));

        expect(response.status).toBe(502);
        expect((await response.json()).error.code).toBe('UPSTREAM_STATUS');
    });

    it('rejects a full response when a range was requested', async () => {
        const handler = createBytesHandler({
            fetch: fetchReturning([], () => new Response(new Uint8Array([1]), { status: 200 }))
        });
        const response = await handler(request(MEDIA_URL, 'bytes=0-0'));

        expect(response.status).toBe(502);
    });

    it('rejects content that is too large', async () => {
        const handler = createBytesHandler({
            fetch: fetchReturning(
                [],
                () =>
                    new Response(new Uint8Array([1]), {
                        status: 200,
                        headers: { 'content-length': '200000001' }
                    })
            )
        });
        const response = await handler(request(MEDIA_URL));

        expect(response.status).toBe(502);
    });

    it('passes an unsatisfied range through', async () => {
        const handler = createBytesHandler({
            fetch: fetchReturning(
                [],
                () =>
                    new Response(null, {
                        status: 416,
                        headers: { 'content-range': 'bytes */100' }
                    })
            )
        });
        const response = await handler(request(MEDIA_URL, 'bytes=200-300'));

        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */100');
    });

    it('stops an oversized stream that omits content-length', async () => {
        let oversized = true;
        const handler = createBytesHandler({
            fetch: async () => {
                if (!oversized)
                    return new Response(new Uint8Array([1]), {
                        status: 206,
                        headers: { 'content-range': 'bytes 0-0/1' }
                    });

                return new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new Uint8Array(MAX_RANGE_BYTES + 1));
                            controller.close();
                        }
                    }),
                    { status: 206 }
                );
            }
        });
        const response = await handler(request(MEDIA_URL, 'bytes=0-65535'));

        await expect(response.arrayBuffer()).rejects.toThrow();

        oversized = false;
        const next = await handler(request(MEDIA_URL, 'bytes=0-0'));

        expect(next.status).toBe(206);
        expect(new Uint8Array(await next.arrayBuffer())).toEqual(new Uint8Array([1]));
    });

    it('stops a stalled stream and releases the slot', async () => {
        let stalled = true;
        const handler = createBytesHandler({
            bodyIdleTimeoutMs: 50,
            fetch: async (_input, init) => {
                if (!stalled) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });

                const stream = new ReadableStream({
                    start(controller) {
                        init?.signal?.addEventListener('abort', () => {
                            controller.error(new DOMException('Aborted', 'AbortError'));
                        });
                    }
                });

                return new Response(stream, { status: 200 });
            }
        });
        const response = await handler(request(MEDIA_URL));

        await expect(response.arrayBuffer()).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 80));
        stalled = false;

        const next = await handler(request(MEDIA_URL));
        expect(next.status).toBe(200);
    });

    it('caps concurrent streams', async () => {
        const handler = createBytesHandler({
            fetch: fetchReturning(
                [],
                () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
            )
        });
        const responses = await Promise.all([
            handler(request(MEDIA_URL)),
            handler(request(MEDIA_URL)),
            handler(request(MEDIA_URL)),
            handler(request(MEDIA_URL))
        ]);
        const busy = await handler(request(MEDIA_URL));

        expect(responses.every((response) => response.status === 200)).toBe(true);
        expect(busy.status).toBe(429);

        await Promise.all(responses.map((response) => response.body?.cancel()));
    });
});
