import { Err, Ok, type AsyncResult } from 'results-ts';
import { z } from 'zod';
import { viewerFailure, type ViewerFailure } from './errors';

const MediaUrlSchema = z
    .string()
    .max(2_048)
    .refine((value) => {
        try {
            const url = new URL(value);

            return (
                url.protocol === 'https:' &&
                url.hostname === 'lh3.googleusercontent.com' &&
                url.port === '' &&
                /^\/(?:pw\/)?[A-Za-z0-9_-]{20,}(?:=d)?$/.test(url.pathname) &&
                url.search === '' &&
                url.hash === ''
            );
        } catch {
            return false;
        }
    });

const AlbumItemSchema = z
    .object({
        id: z.string().min(1).max(200),
        url: MediaUrlSchema,
        downloadUrl: MediaUrlSchema,
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional()
    })
    .strict();

const AlbumResponseSchema = z
    .object({
        title: z.string().max(200).optional(),
        count: z.number().int().nonnegative(),
        items: z.array(AlbumItemSchema).max(5_000)
    })
    .strict();

const ErrorResponseSchema = z.object({
    error: z.object({ code: z.string().max(64), message: z.string().max(500) })
});

export type AlbumItem = z.infer<typeof AlbumItemSchema>;
export type AlbumResponse = z.infer<typeof AlbumResponseSchema>;

export interface ByteResponse {
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array>;
}

export type ByteFetcher = (
    url: string,
    range: string,
    signal?: AbortSignal
) => AsyncResult<ByteResponse, ViewerFailure>;

const BODY_HEADERS = { 'content-type': 'application/json' };

async function readError(response: Response): Promise<ViewerFailure> {
    try {
        const parsed = ErrorResponseSchema.safeParse(await response.json());
        if (parsed.success) return viewerFailure('proxy_error', parsed.data.error.message);
    } catch {
        return viewerFailure('proxy_error', 'The share service did not answer correctly.');
    }

    return viewerFailure('proxy_error', 'The share service did not answer correctly.');
}

export function createApi(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {
    function loadAlbum(album: string): AsyncResult<AlbumResponse, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            let response: Response;
            try {
                response = await fetchImpl('/api/album', {
                    method: 'POST',
                    headers: BODY_HEADERS,
                    body: JSON.stringify({ album }),
                    cache: 'no-store',
                    credentials: 'omit'
                });
            } catch {
                return Err(
                    viewerFailure('network_failed', 'The share service could not be reached.')
                );
            }

            if (!response.ok) return Err(await readError(response));

            let value: unknown;
            try {
                value = await response.json();
            } catch {
                return Err(
                    viewerFailure('proxy_error', 'The share service did not answer correctly.')
                );
            }

            const parsed = AlbumResponseSchema.safeParse(value);
            if (!parsed.success)
                return Err(
                    viewerFailure('proxy_error', 'The share service returned an unexpected album.')
                );

            return Ok(parsed.data);
        });
    }

    const fetchBytes: ByteFetcher = (url, range) =>
        Ok(undefined).andThenAsync(async () => {
            let response: Response;
            try {
                response = await fetchImpl('/api/bytes', {
                    method: 'POST',
                    headers: BODY_HEADERS,
                    body: JSON.stringify(range ? { url, range } : { url }),
                    cache: 'no-store',
                    credentials: 'omit'
                });
            } catch {
                return Err(
                    viewerFailure('network_failed', 'The shared item could not be reached.')
                );
            }

            if (!response.ok) return Err(await readError(response));
            if (!response.body)
                return Err(viewerFailure('network_failed', 'The shared item returned no data.'));

            return Ok({ status: response.status, headers: response.headers, body: response.body });
        });

    return { loadAlbum, fetchBytes };
}

export function readPrefix(
    response: ByteResponse,
    limit: number
): AsyncResult<Uint8Array, ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => {
        const reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;

        try {
            while (size < limit) {
                const next = await reader.read();
                if (next.done) break;

                const take = next.value.subarray(0, limit - size);
                parts.push(take);
                size += take.byteLength;
            }
        } catch {
            return Err(
                viewerFailure(
                    'network_failed',
                    'The shared item ended before its header could be read.'
                )
            );
        }

        if (size === limit) {
            try {
                await reader.cancel();
            } catch {
                return Ok(concatParts(parts, size));
            }
        }

        return Ok(concatParts(parts, size));
    });
}

function concatParts(parts: Uint8Array[], size: number): Uint8Array {
    if (parts.length === 1) return parts[0];

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }

    return bytes;
}
