import { createHash } from 'node:crypto';
import { Err, Ok } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';

export const PAYLOAD = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function fileOf(payload: Uint8Array, chunkCount = 1): ShareFile {
    return {
        id: 'share-file-id',
        fileHash: createHash('sha256').update(payload).digest('hex'),
        name: 'retry.bin',
        relativeFolder: '',
        chunkCount,
        size: payload.length
    };
}

export function asyncOk<T>(value: T) {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

export function asyncErr(
    error: ApplicationError & {
        readonly status?: number;
        readonly retryAfterSeconds?: number;
    }
) {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

export function session(
    index: number,
    payload: Uint8Array<ArrayBuffer>,
    chunkCount = 1,
    url = 'https://edge.example/api/bytes'
) {
    return asyncOk({
        url,
        capability: 'capability',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        chunk: { index, size: payload.length, isLast: index === chunkCount - 1 }
    });
}

export function payloadResponse(payload: Uint8Array<ArrayBuffer>): Response {
    return new Response(payload, {
        status: 206,
        headers: { 'content-range': `bytes 0-${payload.length - 1}/${payload.length}` }
    });
}

export function rateLimited(retryAfterSeconds: number) {
    return asyncErr({
        code: 'REQUEST_FAILED',
        message: 'Rate limited.',
        status: 429,
        retryAfterSeconds
    });
}

export function requestFailed(status: number) {
    return asyncErr({
        code: 'REQUEST_FAILED',
        message: 'Request failed.',
        status
    });
}
