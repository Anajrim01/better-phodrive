import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import pLimit from 'p-limit';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { guardedSend, readBody } from '../transport';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage, type ParsedLibraryPage } from './metadata';
import { LIBRARY_STATE_REQUEST } from './requests';
import { namedAsNonPhodrive, probeLibraryItem } from './probe';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const LIBRARY_PROBE_CONCURRENCY = 2;

export type LibraryPage = {
    items: RemoteBmp[];
    nextPageToken: string;
    syncToken?: Buffer;
    deletedMediaKeys: string[];
    moreSync: boolean;
};

export function readLibraryPage(
    email: string,
    token: string,
    pageToken: string,
    syncToken: Buffer | undefined,
    fetcher: Fetcher = photosFetch
): AsyncResult<LibraryPage, ServerError> {
    return authenticatedHeaders(email, token, fetcher).andThenAsync(async (headers) => {
        const request =
            pageToken || syncToken
                ? pageRequest(Buffer.from(pageToken, 'base64url'), syncToken)
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
    page: ParsedLibraryPage,
    headers: PhotosHeaders,
    fetcher: Fetcher
): AsyncResult<LibraryPage, ServerError> {
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
            nextPageToken: page.nextPageToken,
            ...(page.syncToken ? { syncToken: page.syncToken } : {}),
            deletedMediaKeys: page.deletedMediaKeys,
            moreSync: page.moreSync
        });
    });
}
