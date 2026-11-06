import { readCapability, type ShareCapability } from './capability';
import { BYTES_IDLE_TIMEOUT_MS } from './limits';

export type BytesDeps = {
    fetch: typeof fetch;
    secret: string | undefined;
    now?: () => number;
};

const RESPONSE_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'accept-ranges, content-length, content-range',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'",
    'content-type': 'application/octet-stream',
    'referrer-policy': 'no-referrer',
    vary: 'authorization',
    'x-content-type-options': 'nosniff'
} as const;

type ByteRange = { start: number; end: number; length: number };

function failure(status: number, message: string, extra: Record<string, string> = {}): Response {
    return new Response(message, {
        status,
        headers: {
            ...RESPONSE_HEADERS,
            'content-type': 'text/plain; charset=utf-8',
            ...extra
        }
    });
}

function parseRange(value: string | null, size: number): ByteRange | null {
    if (!value) return null;

    const match = /^bytes=(\d{1,12})-(\d{1,12})$/.exec(value.trim());
    if (!match) return null;

    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start > end || end >= size) return null;

    return { start, end, length: end - start + 1 };
}

function upstreamMatches(value: string | null, start: number, end: number, total: number): boolean {
    return value === `bytes ${start}-${end}/${total}`;
}

function rangeBody(
    body: ReadableStream<Uint8Array>,
    expected: number,
    abort: () => void,
    cleanup: () => void
): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let sent = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };
    const finish = () => {
        if (finished) return false;

        finished = true;
        clear();
        cleanup();

        return true;
    };
    const arm = (output: ReadableStreamDefaultController<Uint8Array>) => {
        timer = setTimeout(() => {
            abort();
            if (finish()) output.error(new Error('Upstream body timed out'));
        }, BYTES_IDLE_TIMEOUT_MS);
    };

    return new ReadableStream<Uint8Array>({
        async pull(output) {
            try {
                arm(output);
                const next = await reader.read();
                clear();
                if (finished) return;

                if (next.done) {
                    finish();

                    if (sent === expected) output.close();
                    else output.error(new Error('Upstream body ended early'));

                    return;
                }

                sent += next.value.byteLength;
                if (sent > expected) {
                    abort();
                    finish();
                    output.error(new Error('Upstream body exceeded its range'));

                    return;
                }

                output.enqueue(next.value);
            } catch (error) {
                abort();
                if (finish()) output.error(error);
            }
        },
        cancel(reason) {
            abort();
            finish();

            return reader.cancel(reason).catch(() => {});
        }
    });
}

function upstreamFailure(
    upstream: Response,
    range: ByteRange,
    capability: ShareCapability
): Response | null {
    if (upstream.status >= 300 && upstream.status < 400)
        return failure(502, 'The media source tried to redirect.');
    if (upstream.status !== 206 || !upstream.body)
        return failure(
            upstream.status === 416 ? 416 : 502,
            'The media source did not return the requested range.'
        );

    const start = capability.o + range.start;
    const end = capability.o + range.end;
    if (!upstreamMatches(upstream.headers.get('content-range'), start, end, capability.n))
        return failure(502, 'The media source returned a different range.');

    const length = upstream.headers.get('content-length');
    if (length !== null && Number(length) !== range.length)
        return failure(502, 'The media source returned an unexpected length.');

    return null;
}

async function proxy(capability: ShareCapability, request: Request, deps: BytesDeps) {
    const range = parseRange(request.headers.get('range'), capability.p);
    if (!range)
        return failure(416, 'A single bounded byte range within this payload is required.', {
            'content-range': `bytes */${capability.p}`
        });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const cleanup = () => request.signal.removeEventListener('abort', onAbort);
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();

    const headersTimer = setTimeout(onAbort, BYTES_IDLE_TIMEOUT_MS);
    let upstream: Response;
    try {
        upstream = await deps.fetch(capability.u, {
            method: 'GET',
            redirect: 'manual',
            headers: {
                range: `bytes=${capability.o + range.start}-${capability.o + range.end}`,
                'accept-encoding': 'identity'
            },
            signal: controller.signal
        });
    } catch {
        cleanup();

        return failure(502, 'The media source could not be reached.');
    } finally {
        clearTimeout(headersTimer);
    }

    const rejected = upstreamFailure(upstream, range, capability);
    if (rejected || !upstream.body) {
        await upstream.body?.cancel().catch(() => {});
        cleanup();

        return rejected ?? failure(502, 'The media source returned no body.');
    }

    const body = rangeBody(upstream.body, range.length, onAbort, cleanup);

    return new Response(body, {
        status: 206,
        headers: {
            ...RESPONSE_HEADERS,
            'content-length': String(range.length),
            'content-range': `bytes ${range.start}-${range.end}/${capability.p}`
        }
    });
}

export async function handleBytes(request: Request, deps: BytesDeps): Promise<Response> {
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...RESPONSE_HEADERS,
                'access-control-allow-headers': 'authorization, range',
                'access-control-allow-methods': 'GET, OPTIONS',
                'access-control-max-age': '600'
            }
        });
    }
    if (request.method !== 'GET') return failure(405, 'Method not allowed.');
    if (!deps.secret) return failure(503, 'Public sharing is not configured here.');

    const authorization = request.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    if (!token || token.length > 4_096) return failure(401, 'A download capability is required.');

    const read = await readCapability(token, deps.secret, deps.now?.() ?? Date.now());
    if (!read.ok) return failure(401, 'This download capability is invalid or expired.');

    return proxy(read.capability, request, deps);
}
