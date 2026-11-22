import { Ok } from 'results-ts';
import type { Fetcher } from '../../fetcher';
import { bodyBytes } from '../../protobuf';
import type { PhotosHeaders } from '../auth';
import type { ThrottleScope } from '../throttle';
import { guardedSend, readBody } from '../transport';
import { pageRequest, parseLibraryPage } from './metadata';
import { LIBRARY_STATE_REQUEST } from './requests';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
export const MAX_PROVIDER_PAGE_TOKEN_LENGTH = 8192;

export function readListingPage(
    token: string,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    scope: ThrottleScope
) {
    const request = token
        ? pageRequest(Buffer.from(token, 'base64url'))
        : Ok(Buffer.from(LIBRARY_STATE_REQUEST, 'base64'));

    return request.andThenAsync((body) =>
        guardedSend(
            scope,
            fetcher,
            LIBRARY_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: headers.rpcHeaders,
                body: bodyBytes(body),
                signal: scope.signal
            },
            'Library list'
        )
            .andThenAsync((response) => readBody(response, 'Library list'))
            .andThen(parseLibraryPage)
    );
}
