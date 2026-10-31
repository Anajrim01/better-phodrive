import { SERVER_ERRORS, throttleError, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import pLimit from 'p-limit';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { guardedSend, readBody } from '../transport';
import {
    parseRetryAfter,
    recordServerFailure,
    recordSuccess,
    recordThrottle,
    throttleWaitSeconds
} from '../throttle';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage, type LibraryCandidate } from './metadata';
import { decodeSplitHeader, MAX_SPLIT_HEADER_BYTES } from '../../bmp/index';
import { LIBRARY_STATE_REQUEST } from './requests';
import { preparedDownloadUrl } from '../download';
import { readProbe, writeProbe } from './probe-cache';

export { clearProbeCache } from './probe-cache';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const HEADER_PROBE_BYTES = MAX_SPLIT_HEADER_BYTES;
const LIBRARY_PROBE_CONCURRENCY = 4;
const MAX_PAGE_TOKEN_LENGTH = 8192;
export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    const validated =
        pageToken.length > MAX_PAGE_TOKEN_LENGTH ||
        (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : Ok(pageToken);

    return validated
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync((headers) => {
            const visited = new Set<string>();

            return findFilePage(email, pageToken, headers, fetcher, visited).andThenAsync(
                async (page) => {
                    if (!page.nextPageToken) return Ok({ items: page.items, nextPageToken: '' });

                    // Google Photos can return a resume token followed only by an empty sync page.
                    // Look ahead so the UI offers Load more only for confirmed Phodrive files.
                    return await findFilePage(
                        email,
                        page.nextPageToken,
                        headers,
                        fetcher,
                        visited
                    ).map((next) => ({
                        items: page.items,
                        nextPageToken: next.items.length ? next.requestToken : ''
                    }));
                }
            );
        });
}

function findFilePage(
    email: string,
    pageToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    visited: Set<string>
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string; requestToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let nextPageToken = pageToken;

        while (true) {
            const requestToken = nextPageToken;
            if (visited.has(requestToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

            visited.add(requestToken);

            const request = requestToken
                ? pageRequest(Buffer.from(requestToken, 'base64url'))
                : Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));
            const received = await request.andThenAsync((body) =>
                guardedSend(
                    email,
                    fetcher,
                    LIBRARY_URL,
                    {
                        method: 'POST',
                        redirect: 'manual',
                        headers: headers.rpcHeaders,
                        body: bodyBytes(body)
                    },
                    'Library list'
                )
                    .andThenAsync((response) => readBody(response, 'Library list'))
                    .andThen(parseLibraryPage)
                    .andThenAsync((page) => scanLibraryPage(email, page, headers, fetcher))
                    .map((page) => {
                        nextPageToken = page.nextPageToken;

                        return { ...page, requestToken };
                    })
            );

            const finished = received.match({
                Ok: (page) => page.items.length > 0 || !page.nextPageToken,
                Err: () => true
            });
            if (finished) return received;
        }
    });
}

function scanLibraryPage(
    email: string,
    page: { items: LibraryCandidate[]; nextPageToken: string },
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const limit = pLimit(LIBRARY_PROBE_CONCURRENCY);
        const scanned = await limit.map(page.items, (candidate) =>
            probeLibraryItem(email, candidate, headers.commonHeaders, headers.rpcHeaders, fetcher)
        );

        const items: RemoteBmp[] = [];

        for (const result of scanned) {
            if (result.isErr()) return result;

            result.inspect((item) => {
                if (item !== null) items.push(item);
            });
        }

        return Ok({
            items,
            nextPageToken: page.nextPageToken
        });
    });
}

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

        if (response.status !== 200 && response.status !== 206)
            return Err(SERVER_ERRORS.COULD_NOT_INSPECT_PHOTO_HEADER);

        recordSuccess(email);

        return readPrefix(response);
    });
}

function probeLibraryItem(
    email: string,
    candidate: LibraryCandidate,
    commonHeaders: Record<string, string>,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<RemoteBmp | null, ServerError> {
    const cached = readProbe(email, candidate);
    if (cached !== undefined) return Ok(cached).andThenAsync(async (item) => Ok(item));

    return preparedDownloadUrl(email, candidate.mediaKey, candidate.sha1, rpcHeaders, fetcher)
        .andThenAsync(async (url) => {
            if (url === null) return Ok(null);

            return await fetchPrefix(email, url, commonHeaders, fetcher);
        })
        .map((prefix) => {
            if (prefix === null) return null;

            return decodeSplitHeader(prefix, candidate.size).match({
                Ok: ({ header }) => ({
                    ...candidate,
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    folder: header.folder,
                    size: header.payloadSize
                }),
                Err: () => null
            });
        })
        .map((item) => {
            writeProbe(email, candidate, item);

            return item;
        });
}
