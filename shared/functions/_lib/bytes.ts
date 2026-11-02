import { Err, Ok, type AsyncResult } from 'results-ts';
import { z } from 'zod';
import { proxyError, type ProxyError } from './errors';
import { errorResponse, readJsonBody } from './http';
import {
    BYTES_IDLE_TIMEOUT_MS,
    MAX_BYTES_CONCURRENCY,
    MAX_RANGE_BYTES,
    UPSTREAM_TIMEOUT_MS
} from './limits';
import { discardUpstream, releaseBody } from './bytes-stream';
import { parseMediaUrl, parseRange } from './media-url';

const BytesRequestSchema = z.object({ url: z.string(), range: z.string().optional() }).strict();

export interface BytesDeps {
    fetch: typeof fetch;
    bodyIdleTimeoutMs?: number;
    maxConcurrency?: number;
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
    range: string
): AsyncResult<Upstream, ProxyError> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const headers: Record<string, string> = {
        accept: '*/*',
        'accept-encoding': 'identity'
    };
    headers.range = range;

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

function matchesRequestedRange(value: string | null, requested: string): boolean {
    if (value === null) return true;

    const upstream = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value);
    const expected = /^bytes=(\d+)-(\d+)$/.exec(requested);
    if (!upstream || !expected) return false;

    const start = Number(upstream[1]);
    const end = Number(upstream[2]);
    if (start !== Number(expected[1]) || end > Number(expected[2]) || end < start) return false;

    return upstream[3] === '*' || Number(upstream[3]) > end;
}

function validateUpstream(
    response: Response,
    length: number | null,
    range: string
): ProxyError | null {
    if (response.status >= 300 && response.status < 400) return proxyError('UPSTREAM_REDIRECT');
    if (response.status === 404 || response.status === 410) return proxyError('MEDIA_UNAVAILABLE');
    if (length !== null && length > MAX_RANGE_BYTES) return proxyError('UPSTREAM_STATUS');
    if (response.status === 416) return null;
    if (response.status !== 206) return proxyError('UPSTREAM_STATUS');
    if (!matchesRequestedRange(response.headers.get('content-range'), range))
        return proxyError('UPSTREAM_STATUS');

    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') return proxyError('UPSTREAM_STATUS');

    return null;
}

export function createBytesHandler(deps: BytesDeps = DEFAULT_DEPS) {
    let active = 0;
    const idleTimeoutMs = deps.bodyIdleTimeoutMs ?? BYTES_IDLE_TIMEOUT_MS;
    const maxConcurrency = deps.maxConcurrency ?? MAX_BYTES_CONCURRENCY;

    async function serve(url: string, range: string): Promise<Response> {
        if (active >= maxConcurrency) return errorResponse(proxyError('BUSY'));

        active++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active = Math.max(0, active - 1);
        };

        const upstream = await fetchUpstream(deps, url, range);
        return upstream.match({
            Err: async (error) => {
                release();

                return errorResponse(error);
            },
            Ok: async ({ response, controller }) => {
                const length = contentLength(response);
                const invalid = validateUpstream(response, length, range);
                if (invalid) {
                    discardUpstream(response, controller);
                    release();

                    return errorResponse(invalid);
                }

                if (!response.body) {
                    controller.abort();
                    release();
                    if (response.status === 416)
                        return new Response(null, {
                            status: 416,
                            headers: responseHeaders(response, length)
                        });

                    return errorResponse(proxyError('UPSTREAM_UNAVAILABLE'));
                }

                const body = releaseBody(
                    response.body,
                    release,
                    MAX_RANGE_BYTES,
                    controller,
                    idleTimeoutMs
                );

                return new Response(body, {
                    status: response.status,
                    headers: responseHeaders(response, length)
                });
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
                            Ok: (range) => serve(media.url, range)
                        })
                })
        });
    };
}

export const handleBytes = createBytesHandler();
