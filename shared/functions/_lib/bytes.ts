import { Err, Ok, type AsyncResult } from 'results-ts';
import { z } from 'zod';
import { proxyError, type ProxyError } from './errors';
import { errorResponse, readJsonBody } from './http';
import {
    BYTES_IDLE_TIMEOUT_MS,
    MAX_BYTES_CONCURRENCY,
    MAX_CHUNK_BYTES,
    MAX_RANGE_BYTES,
    UPSTREAM_TIMEOUT_MS
} from './limits';
import { parseMediaUrl, parseRange } from './media-url';

const BytesRequestSchema = z.object({ url: z.string(), range: z.string().optional() }).strict();

export interface BytesDeps {
    fetch: typeof fetch;
    bodyIdleTimeoutMs?: number;
}

const DEFAULT_DEPS: BytesDeps = { fetch: globalThis.fetch.bind(globalThis) };

const RESPONSE_HEADERS = {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="phodrive-chunk.bin"',
    'content-security-policy': "default-src 'none'",
    'content-type': 'application/octet-stream',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
} as const;

interface Upstream {
    response: Response;
    controller: AbortController;
}

function fetchUpstream(
    deps: BytesDeps,
    url: string,
    range: string | undefined
): AsyncResult<Upstream, ProxyError> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const headers: Record<string, string> = {
        accept: '*/*',
        'accept-encoding': 'identity'
    };
    if (range) headers.range = range;

    return Ok(undefined).andThenAsync(async () => {
        try {
            const response = await deps.fetch(url, {
                headers,
                redirect: 'manual',
                signal: controller.signal
            });

            return Ok({ response, controller });
        } catch {
            return Err(proxyError('UPSTREAM_UNAVAILABLE'));
        } finally {
            clearTimeout(timer);
        }
    });
}

function contentLength(response: Response): number | null {
    const value = response.headers.get('content-length');
    if (value === null || !/^\d+$/.test(value)) return null;

    return Number(value);
}

function responseHeaders(response: Response, length: number | null): Headers {
    const headers = new Headers(RESPONSE_HEADERS);
    if (length !== null) headers.set('content-length', String(length));

    const range = response.headers.get('content-range');
    if (range) headers.set('content-range', range);

    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) headers.set('accept-ranges', acceptRanges);

    return headers;
}

function releaseBody(
    body: ReadableStream<Uint8Array>,
    release: () => void,
    limit: number,
    controller: AbortController,
    idleTimeoutMs: number
): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forwarded = 0;
    let finished = false;

    const clearTimer = () => {
        if (timer === undefined) return;

        clearTimeout(timer);
        timer = undefined;
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimer();
        release();
    };
    const armTimer = () => {
        clearTimer();
        timer = setTimeout(() => {
            controller.abort();
            finish();
        }, idleTimeoutMs);
    };

    armTimer();

    return new ReadableStream<Uint8Array>({
        async pull(output) {
            try {
                const next = await reader.read();
                if (next.done) {
                    finish();
                    output.close();

                    return;
                }

                if (forwarded + next.value.byteLength > limit) {
                    finish();
                    await reader.cancel();
                    output.error(new Error('Upstream body exceeded the proxy limit'));

                    return;
                }

                forwarded += next.value.byteLength;
                output.enqueue(next.value);
                armTimer();
            } catch (error) {
                finish();
                output.error(error);
            }
        },
        async cancel(reason) {
            finish();
            await reader.cancel(reason);
        }
    });
}

function validateUpstream(
    response: Response,
    range: string | undefined,
    length: number | null
): ProxyError | null {
    if (response.status >= 300 && response.status < 400) return proxyError('UPSTREAM_REDIRECT');
    if (response.status === 404 || response.status === 410) return proxyError('MEDIA_UNAVAILABLE');
    if (response.status === 416) return null;
    if (response.status !== 200 && response.status !== 206) return proxyError('UPSTREAM_STATUS');
    if (range && response.status !== 206) return proxyError('UPSTREAM_STATUS');
    if (!range && response.status !== 200) return proxyError('UPSTREAM_STATUS');
    if (length !== null && length > MAX_CHUNK_BYTES) return proxyError('UPSTREAM_STATUS');
    if (range && length !== null && length > MAX_RANGE_BYTES) return proxyError('UPSTREAM_STATUS');

    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') return proxyError('UPSTREAM_STATUS');

    return null;
}

export function createBytesHandler(deps: BytesDeps = DEFAULT_DEPS) {
    let active = 0;
    const idleTimeoutMs = deps.bodyIdleTimeoutMs ?? BYTES_IDLE_TIMEOUT_MS;

    async function serve(url: string, range: string | undefined): Promise<Response> {
        if (active >= MAX_BYTES_CONCURRENCY) return errorResponse(proxyError('BUSY'));

        active++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active = Math.max(0, active - 1);
        };

        const upstream = await fetchUpstream(deps, url, range);
        return upstream.match({
            Err: (error) => {
                release();

                return errorResponse(error);
            },
            Ok: ({ response, controller }) => {
                const length = contentLength(response);
                const invalid = validateUpstream(response, range, length);
                if (invalid) {
                    release();

                    return errorResponse(invalid);
                }

                if (!response.body) {
                    release();
                    if (response.status === 416)
                        return new Response(null, {
                            status: 416,
                            headers: responseHeaders(response, length)
                        });

                    return errorResponse(proxyError('UPSTREAM_UNAVAILABLE'));
                }

                return new Response(
                    releaseBody(
                        response.body,
                        release,
                        range ? MAX_RANGE_BYTES : MAX_CHUNK_BYTES,
                        controller,
                        idleTimeoutMs
                    ),
                    {
                        status: response.status,
                        headers: responseHeaders(response, length)
                    }
                );
            }
        });
    }

    return async function handleBytes(request: Request): Promise<Response> {
        const body = await readJsonBody(request, BytesRequestSchema);
        return body.match({
            Err: async (error) => errorResponse(error),
            Ok: async (value) =>
                parseMediaUrl(value.url).match({
                    Err: async (error) => errorResponse(error),
                    Ok: async (media) =>
                        parseRange(value.range).match({
                            Err: async (error) => errorResponse(error),
                            Ok: (range) => serve(media.url, range || undefined)
                        })
                })
        });
    };
}

export const handleBytes = createBytesHandler();
