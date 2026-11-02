import { describe, expect, it } from 'vitest';
import { createBytesHandler } from '../functions/_lib/bytes';
import { MAX_RANGE_BYTES } from '../functions/_lib/limits';

const MEDIA_URL = 'https://lh3.googleusercontent.com/pw/token-one-abcdefghijklmnop';

function request(url: string, range?: string): Request {
    return new Request('https://shared.phodrive.dev/api/bytes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(range ? { url, range } : { url })
    });
}

describe('byte stream limits', () => {
    it('stops an oversized stream that omits content-length', async () => {
        let oversized = true;
        const handler = createBytesHandler({
            maxConcurrency: 1,
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
                        },
                        cancel() {
                            return new Promise<void>(() => undefined);
                        }
                    }),
                    { status: 206 }
                );
            }
        });
        const response = await handler(request(MEDIA_URL, 'bytes=0-65535'));
        const outcome = await Promise.race([
            response.arrayBuffer().then(
                () => 'resolved',
                () => 'rejected'
            ),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))
        ]);

        expect(outcome).toBe('rejected');

        oversized = false;
        const next = await handler(request(MEDIA_URL, 'bytes=0-0'));

        expect(next.status).toBe(206);
        expect(new Uint8Array(await next.arrayBuffer())).toEqual(new Uint8Array([1]));
    });

    it('does not wait for an upstream cancellation that never settles', async () => {
        const handler = createBytesHandler({
            fetch: async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new Uint8Array([1, 2, 3]));
                        },
                        cancel() {
                            return new Promise<void>(() => undefined);
                        }
                    }),
                    { status: 200 }
                )
        });
        const response = await handler(request(MEDIA_URL));
        const outcome = await Promise.race([
            response.body?.cancel().then(() => 'cancelled'),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 500))
        ]);

        expect(outcome).toBe('cancelled');
    });

    it('stops a stalled stream and releases the slot', async () => {
        let stalled = true;
        const handler = createBytesHandler({
            bodyIdleTimeoutMs: 50,
            maxConcurrency: 1,
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

    it('cancels an upstream body that fails validation', async () => {
        let cancelled = false;
        const handler = createBytesHandler({
            fetch: async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new Uint8Array([1, 2, 3]));
                        },
                        cancel() {
                            cancelled = true;
                        }
                    }),
                    {
                        status: 200,
                        headers: { 'content-length': '200000001' }
                    }
                )
        });
        const response = await handler(request(MEDIA_URL));

        expect(response.status).toBe(502);
        await Promise.resolve();
        expect(cancelled).toBe(true);
    });

    it('caps concurrent streams', async () => {
        const handler = createBytesHandler({
            fetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })
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
