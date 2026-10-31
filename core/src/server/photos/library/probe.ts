import { SERVER_ERRORS, throttleError, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import type { Fetcher } from '../../fetcher';
import {
    parseRetryAfter,
    recordServerFailure,
    recordServerSuccess,
    recordSuccess,
    recordThrottle,
    throttleWaitSeconds
} from '../throttle';
import { decodeSplitHeader, MAX_SPLIT_HEADER_BYTES } from '../../bmp/index';
import { BMP_HEADER_BYTES, SPLIT_MAGIC_PREFIX } from '../../../bmp/format';
import { preparedDownloadUrl } from '../download';
import { readProbe, writeProbe } from './probe-cache';
import type { LibraryCandidate } from './metadata';

const HEADER_PROBE_BYTES = MAX_SPLIT_HEADER_BYTES;

function readPrefix(response: Response): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync<Buffer, ServerError>(async () => {
        const reader = response.body?.getReader();
        if (!reader) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

        const parts: Uint8Array[] = [];
        let length = 0;

        try {
            while (length < HEADER_PROBE_BYTES) {
                const next = await reader.read();
                if (next.done) break;

                const part = next.value.subarray(0, HEADER_PROBE_BYTES - length);
                parts.push(part);
                length += part.length;
            }
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        } finally {
            try {
                await reader.cancel();
            } catch {
                // The inspected bytes are still usable if cancellation fails.
            }
        }

        return Ok(Buffer.concat(parts, length));
    });
}

function fetchPrefix(
    email: string,
    url: URL,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const startedAt = Date.now();
        const wait = throttleWaitSeconds(email);
        if (wait !== null) return Err(throttleError(wait));

        let response: Response;

        try {
            response = await fetcher(url, {
                method: 'GET',
                redirect: 'manual',
                headers: {
                    ...commonHeaders,
                    range: `bytes=0-${HEADER_PROBE_BYTES - 1}`
                }
            });
        } catch {
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        }

        const paused =
            response.status === 429
                ? recordThrottle(email, parseRetryAfter(response.headers.get('retry-after')))
                : response.status >= 500
                  ? recordServerFailure(email)
                  : null;
        if (paused !== null) {
            try {
                await response.body?.cancel();
            } catch {
                // The pause still applies when the body cannot be cancelled.
            }

            return Err(throttleError(paused));
        }

        if (response.status !== 200 && response.status !== 206) {
            recordServerSuccess(email);

            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);
        }

        recordSuccess(email, startedAt);

        return readPrefix(response);
    });
}

function definitelyNotPhodrive(prefix: Uint8Array): boolean {
    if (prefix.length < 2) return false;
    if (prefix[0] !== 66 || prefix[1] !== 77) return true;
    if (prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC_PREFIX.length) return false;

    return !SPLIT_MAGIC_PREFIX.every((byte, index) => prefix[BMP_HEADER_BYTES + index] === byte);
}

export function hasPhodriveNames(items: readonly { fileName?: string }[]): boolean {
    return items.some((item) => item.fileName?.includes('.phodrive-'));
}

export function namedAsNonPhodrive(
    candidate: { fileName?: string },
    pageHasPhodriveName: boolean
): boolean {
    return (
        pageHasPhodriveName &&
        candidate.fileName !== undefined &&
        !candidate.fileName.includes('.phodrive-')
    );
}

export function probeLibraryItem(
    email: string,
    candidate: LibraryCandidate,
    commonHeaders: Record<string, string>,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    pageHasPhodriveName: boolean
): AsyncResult<RemoteBmp | null, ServerError> {
    const cached = readProbe(email, candidate);
    if (cached !== undefined)
        return Ok(undefined).andThenAsync<RemoteBmp | null, ServerError>(async () => Ok(cached));

    if (namedAsNonPhodrive(candidate, pageHasPhodriveName)) {
        // Name-based skips stay out of the cache; a renamed chunk must be rechecked.
        return Ok(undefined).andThenAsync<RemoteBmp | null, ServerError>(async () => Ok(null));
    }

    return preparedDownloadUrl(email, candidate.mediaKey, candidate.sha1, rpcHeaders, fetcher)
        .andThenAsync(async (url) => {
            if (url === null) return Ok(null);

            return await fetchPrefix(email, url, commonHeaders, fetcher);
        })
        .map((prefix) => {
            if (prefix === null) return null;

            const item = decodeSplitHeader(prefix, candidate.size).match({
                Ok: ({ header }) => ({
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    folder: header.folder,
                    size: header.payloadSize,
                    at: candidate.at,
                    mediaKey: candidate.mediaKey,
                    sha1: candidate.sha1
                }),
                Err: () => null
            });
            if (item !== null) {
                writeProbe(email, candidate, item);

                return item;
            }
            if (definitelyNotPhodrive(prefix)) writeProbe(email, candidate, null);

            return null;
        });
}
