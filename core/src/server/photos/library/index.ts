import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import pLimit from 'p-limit';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { guardedSend, readBody } from '../transport';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage, type LibraryCandidate } from './metadata';
import { LIBRARY_STATE_REQUEST } from './requests';
import { namedAsNonPhodrive, probeLibraryItem } from './probe';

export { clearProbeCache, configureProbeCache, flushProbeCache } from './probe-cache';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const LIBRARY_PROBE_CONCURRENCY = 2;
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
        .andThenAsync((headers) => readLibraryPage(email, pageToken, headers, fetcher));
}

function readLibraryPage(
    email: string,
    pageToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const request = pageToken
            ? pageRequest(Buffer.from(pageToken, 'base64url'))
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
        );

        return received.andThenAsync((page) => scanLibraryPage(email, page, headers, fetcher));
    });
}

function scanLibraryPage(
    email: string,
    page: { items: LibraryCandidate[]; nextPageToken: string },
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const candidates = page.items.filter((candidate) => !namedAsNonPhodrive(candidate));
        const limit = pLimit(LIBRARY_PROBE_CONCURRENCY);
        const scanned = await limit.map(candidates, (candidate) =>
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
