import { expect, test } from 'vitest';
import { handleBytes } from '../../functions/_lib/bytes';
import { MEDIA_HOSTS, readCapability } from '../../functions/_lib/capability';
import { MEDIA_HOSTS as PRODUCER_HOSTS } from '../../../core/src/server/photos/download';
import { encodeCapability } from '../../../server/src/shares/capability';
import {
    KEY,
    MEDIA_URL,
    OFFSET,
    PAYLOAD,
    SECRET,
    TOTAL,
    bodyLength,
    capability,
    rangeResponse,
    rangedBody,
    request
} from '../helpers/edge';

test('maps a payload range to the BMP and answers only in payload terms', async () => {
    let upstream: RequestInit | undefined;
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: async (_url, init) => {
            upstream = init;

            return rangeResponse(1_000);
        }
    });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-999/1000');
    expect(response.headers.get('content-length')).toBe('1000');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await bodyLength(response)).toBe(1_000);
    expect(upstream?.headers).toMatchObject({
        range: 'bytes=200-1199',
        'accept-encoding': 'identity'
    });
    expect(upstream?.redirect).toBe('manual');
});

test('a partial payload range returns exactly those bytes', async () => {
    const stored = Uint8Array.from({ length: TOTAL }, (_, index) => index % 251);
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=10-19'), {
        secret: SECRET,
        fetch: async (_url, init) => {
            const match = /bytes=(\d+)-(\d+)/.exec(
                (init?.headers as Record<string, string>).range
            )!;
            const [start, end] = [Number(match[1]), Number(match[2])];

            return new Response(stored.slice(start, end + 1), {
                status: 206,
                headers: { 'content-range': `bytes ${start}-${end}/${TOTAL}` }
            });
        }
    });

    expect(response.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        stored.slice(OFFSET + 10, OFFSET + 20)
    );
});

test('rejects missing, tampered, expired and foreign-host capabilities', async () => {
    let fetched = 0;
    const deps = {
        secret: SECRET,
        fetch: async () => {
            fetched++;

            return rangeResponse(1_000);
        }
    };
    const token = await capability();
    const tampered = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;

    expect((await handleBytes(request(null, 'bytes=0-999'), deps)).status).toBe(401);
    expect((await handleBytes(request(tampered, 'bytes=0-999'), deps)).status).toBe(401);
    expect(
        (
            await handleBytes(request(token, 'bytes=0-999'), {
                ...deps,
                secret: Buffer.alloc(32, 255).toString('base64')
            })
        ).status
    ).toBe(401);
    expect(
        (
            await handleBytes(
                request(await capability({ e: Math.floor(Date.now() / 1000) - 1 }), 'bytes=0-999'),
                deps
            )
        ).status
    ).toBe(401);
    expect(
        (
            await handleBytes(
                request(await capability({ u: 'https://evil.example/pw/token' }), 'bytes=0-999'),
                deps
            )
        ).status
    ).toBe(401);
    expect(fetched).toBe(0);
});

test('the edge and the producer allow the same media hosts', () => {
    expect([...MEDIA_HOSTS]).toEqual([...PRODUCER_HOSTS]);
});

test.each([1, 2, 3, 4, 5])('streams from lh%i', async (host) => {
    const media = `https://lh${host}.googleusercontent.com/pw/test`;
    let fetchedUrl = '';
    const response = await handleBytes(request(await capability({ u: media }), 'bytes=0-9'), {
        secret: SECRET,
        fetch: async (url) => {
            fetchedUrl = String(url);

            return rangeResponse(10);
        }
    });

    expect(response.status).toBe(206);
    expect(fetchedUrl).toBe(media);
});

test.each([
    'https://lh6.googleusercontent.com/pw/test',
    'https://lh0.googleusercontent.com/pw/test',
    'https://other.googleusercontent.com/pw/test',
    'https://googleusercontent.com/pw/test',
    'https://lh3.googleusercontent.com.example.com/pw/test',
    'http://lh3.googleusercontent.com/pw/test',
    'https://lh3.googleusercontent.com:8443/pw/test',
    'https://user:secret@lh3.googleusercontent.com/pw/test',
    'https://lh3.googleusercontent.com/pw/test#fragment'
])('rejects %s before touching upstream', async (media) => {
    let fetched = 0;
    const response = await handleBytes(request(await capability({ u: media }), 'bytes=0-9'), {
        secret: SECRET,
        fetch: async () => {
            fetched++;

            return rangeResponse(10);
        }
    });

    expect(response.status).toBe(401);
    expect(fetched).toBe(0);
});

test('rejects a range outside the payload before touching upstream', async () => {
    const token = await capability();
    let fetched = 0;
    const deps = {
        secret: SECRET,
        fetch: async () => {
            fetched++;

            return rangeResponse(1_000);
        }
    };

    for (const range of [
        'bytes=0-1000',
        'bytes=1000-1000',
        'bytes=5-4',
        'bytes=0-',
        'bytes=0-1,2-3',
        'bytes=-5',
        'bytes=-1-0',
        'bytes=0-9007199254740992',
        'bytes=9007199254740992-9007199254740993'
    ])
        expect((await handleBytes(request(token, range), deps)).status).toBe(416);

    const missing = await handleBytes(request(token), deps);
    expect(missing.status).toBe(416);
    expect(missing.headers.get('content-range')).toBe('bytes */1000');
    expect(fetched).toBe(0);
});

test.each([0, 500, PAYLOAD - 1])(
    'payload byte %i is mapped to its exact authenticated extent',
    async (index) => {
        const token = await capability();
        let range: string | null = null;
        let authorization: string | null = null;
        let userAgent: string | null = null;
        const response = await handleBytes(request(token, `bytes=${index}-${index}`), {
            secret: SECRET,
            fetch: async (_url, init) => {
                const headers = new Headers(init?.headers);
                range = headers.get('range');
                authorization = headers.get('authorization');
                userAgent = headers.get('user-agent');
                return rangeResponse(
                    1,
                    new ReadableStream({
                        start(c) {
                            c.enqueue(Uint8Array.of(index % 251));
                            c.close();
                        }
                    }),
                    OFFSET + index
                );
            }
        });
        expect(range).toBe(`bytes=${OFFSET + index}-${OFFSET + index}`);
        expect(authorization).toBeNull();
        expect(userAgent).toBeNull();
        expect(response.status).toBe(206);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(index % 251));
    }
);

test('rejects capabilities whose payload does not fit the BMP', async () => {
    const deps = { secret: SECRET, fetch: async () => rangeResponse(1_000) };

    for (const overrides of [{ o: 600 }, { p: -1 }, { o: -1 }, { n: 200_000_001 }, { p: 1.5 }]) {
        const token = await capability(overrides);

        expect((await handleBytes(request(token, 'bytes=0-9'), deps)).status).toBe(401);
    }
});

test('rejects an upstream range that differs from the mapped one', async () => {
    const token = await capability();

    for (const contentRange of [
        'bytes 0-999/1500',
        'bytes 200-1198/1500',
        'bytes 200-1199/1000',
        'bytes */1500'
    ]) {
        const response = await handleBytes(request(token, 'bytes=0-999'), {
            secret: SECRET,
            fetch: async () =>
                new Response(rangedBody(1_000), {
                    status: 206,
                    headers: { 'content-range': contentRange }
                })
        });

        expect(response.status).toBe(502);
    }
});

test('a whole-file 200 from upstream is rejected, not relayed', async () => {
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: async () => new Response(rangedBody(TOTAL), { status: 200 })
    });

    expect(response.status).toBe(502);
});

test('without a key the edge reports sharing is off', async () => {
    const response = await handleBytes(request('anything', 'bytes=0-9'), {
        secret: undefined,
        fetch: async () => rangeResponse(1_000)
    });

    expect(response.status).toBe(503);
});

test('rejects redirects instead of following them', async () => {
    const token = await capability();
    const response = await handleBytes(request(token, 'bytes=0-999'), {
        secret: SECRET,
        fetch: async () =>
            new Response(null, {
                status: 302,
                headers: { location: 'https://evil.example/file' }
            })
    });

    expect(response.status).toBe(502);
});

test('answers preflight and wrong methods without touching the capability', async () => {
    const deps = {
        secret: SECRET,
        fetch: async () => rangeResponse(1_000)
    };
    const options = await handleBytes(
        new Request('https://phodrive.example/api/bytes', { method: 'OPTIONS' }),
        deps
    );
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-headers')).toContain('range');

    const post = await handleBytes(
        new Request('https://phodrive.example/api/bytes', { method: 'POST' }),
        deps
    );
    expect(post.status).toBe(405);
});

test('the edge reads a capability the server encoded', async () => {
    const payload = {
        v: 1 as const,
        s: 'share-id',
        f: 'file-id',
        c: 0,
        u: MEDIA_URL,
        o: OFFSET,
        p: PAYLOAD,
        n: TOTAL,
        e: Math.floor(Date.now() / 1000) + 300
    };

    const read = await readCapability(encodeCapability(payload, KEY), SECRET);

    expect(read).toEqual({ ok: true, capability: payload });
});
