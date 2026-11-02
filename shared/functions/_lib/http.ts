import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ZodType } from 'zod';
import { proxyError, type ProxyError } from './errors';
import { MAX_REQUEST_BYTES } from './limits';

const BASE_HEADERS = {
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
} as const;

export function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            ...BASE_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'content-security-policy': "default-src 'none'"
        }
    });
}

export function errorResponse(error: ProxyError): Response {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
}

export function methodNotAllowed(allowed: string): Response {
    return new Response(null, {
        status: 405,
        headers: {
            ...BASE_HEADERS,
            allow: allowed
        }
    });
}

export function rejectCrossOrigin(request: Request): Response | null {
    const origin = request.headers.get('origin');
    if (!origin) return null;
    if (origin === new URL(request.url).origin) return null;

    return errorResponse(proxyError('CROSS_ORIGIN'));
}

function readCappedBytes(
    stream: ReadableStream<Uint8Array> | null,
    limit: number
): AsyncResult<Uint8Array, ProxyError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!stream) return Err(proxyError('INVALID_REQUEST'));

        const reader = stream.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;

        try {
            for (;;) {
                const next = await reader.read();
                if (next.done) break;

                size += next.value.byteLength;
                if (size > limit) {
                    await reader.cancel();

                    return Err(proxyError('ALBUM_RESPONSE_TOO_LARGE'));
                }

                parts.push(next.value);
            }
        } catch {
            return Err(proxyError('UPSTREAM_UNAVAILABLE'));
        }

        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
            bytes.set(part, offset);
            offset += part.byteLength;
        }

        return Ok(bytes);
    });
}

export function readCappedText(response: Response, limit: number): AsyncResult<string, ProxyError> {
    return Ok(undefined).andThenAsync(async () => {
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > limit)
            return Err(proxyError('ALBUM_RESPONSE_TOO_LARGE'));

        const bytes = await readCappedBytes(response.body, limit);
        return bytes.match({
            Err: (error) => Err(error),
            Ok: (value) => {
                try {
                    return Ok(new TextDecoder('utf-8', { fatal: true }).decode(value));
                } catch {
                    return Err(proxyError('ALBUM_SHAPE_CHANGED'));
                }
            }
        });
    });
}

export function readJsonBody<T>(request: Request, schema: ZodType<T>): AsyncResult<T, ProxyError> {
    return Ok(undefined).andThenAsync(async () => {
        const length = Number(request.headers.get('content-length'));
        if (Number.isFinite(length) && length > MAX_REQUEST_BYTES)
            return Err(proxyError('INVALID_REQUEST'));

        const bytes = await readCappedBytes(request.body, MAX_REQUEST_BYTES);
        return bytes.match({
            Err: (error) => Err(error),
            Ok: (value) => {
                let parsed: unknown;

                try {
                    parsed = JSON.parse(new TextDecoder().decode(value));
                } catch {
                    return Err(proxyError('INVALID_REQUEST'));
                }

                const result = schema.safeParse(parsed);
                if (!result.success) return Err(proxyError('INVALID_REQUEST'));

                return Ok(result.data);
            }
        });
    });
}
