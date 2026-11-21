import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { LibraryWarning, RemoteBmp } from '../../../models';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { guardedSend, readBody } from '../transport';
import { bodyBytes } from '../../protobuf';
import { pageRequest, parseLibraryPage } from './metadata';
import { scanLibraryPage } from './probe';
import type { ChunkMetadataStore } from './metadata-store';
import { LIBRARY_STATE_REQUEST } from './requests';
import { defaultThrottle, type ThrottleScope } from '../throttle';

const LIBRARY_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/18047484249733410717';
const MAX_PAGE_TOKEN_LENGTH = 8192;

/** A page of files with a continuation only when another file page exists. */
export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch,
    metadata?: ChunkMetadataStore,
    scope?: ThrottleScope
) {
    return listBmpPages(email, token, pageToken, fetcher, metadata, scope).map(
        ({ items, nextPageToken, warnings }) => ({ items, nextPageToken, warnings })
    );
}

/** Read up to the requested number of file pages with one authentication request. */
export function listBmpPages(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch,
    metadata?: ChunkMetadataStore,
    scope?: ThrottleScope,
    pageCount = 1
): AsyncResult<
    {
        items: RemoteBmp[];
        nextPageToken: string;
        warnings: LibraryWarning[];
        pageTokens: string[];
    },
    ServerError
> {
    const validated =
        pageToken.length > MAX_PAGE_TOKEN_LENGTH ||
        (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : Ok(pageToken);
    const throttle = scope ?? { key: email, coordinator: defaultThrottle };

    return validated
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher, throttle))
        .andThenAsync(async (headers) => {
            const visited = new Set<string>();
            const first = await findFilePage(
                pageToken,
                headers,
                fetcher,
                visited,
                metadata,
                throttle
            );
            if (first.isErr()) return first;

            const initial = first.unwrap();
            const items = [...initial.items];
            const warnings = [...initial.warnings];
            let nextPageToken = initial.nextPageToken;
            const pageTokens = [initial.requestToken];

            while (nextPageToken) {
                const following = await findFilePage(
                    nextPageToken,
                    headers,
                    fetcher,
                    visited,
                    metadata,
                    throttle,
                    pageTokens.length >= pageCount
                );
                if (following.isErr()) return following;

                const next = following.unwrap();
                warnings.push(...next.warnings);

                // A resume token can lead to an empty tail. Expose Load more only if
                // the lookahead found file items, and reuse that page within the batch.
                if (!next.items.length) {
                    nextPageToken = '';
                    break;
                }
                if (pageTokens.length >= pageCount) {
                    nextPageToken = next.requestToken;
                    break;
                }

                items.push(...next.items);
                pageTokens.push(next.requestToken);
                nextPageToken = next.nextPageToken;
            }

            return Ok({ items, nextPageToken, warnings, pageTokens });
        });
}

/** Fetch one library page and keep only its Phodrive files. */
function readLibraryPage(
    requestToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    metadata: ChunkMetadataStore | undefined,
    scope: ThrottleScope,
    lookahead: boolean
): AsyncResult<
    { items: RemoteBmp[]; nextPageToken: string; warnings: LibraryWarning[] },
    ServerError
> {
    const request = requestToken
        ? pageRequest(Buffer.from(requestToken, 'base64url'))
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
                ...(scope.signal ? { signal: scope.signal } : {})
            },
            'Library list'
        )
            .andThenAsync((response) => readBody(response, 'Library list'))
            .andThen(parseLibraryPage)
            .andThenAsync((page) =>
                scanLibraryPage(page, headers, fetcher, metadata, scope, lookahead)
            )
    );
}

function findFilePage(
    pageToken: string,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    visited: Set<string>,
    metadata: ChunkMetadataStore | undefined,
    scope: ThrottleScope,
    lookahead = false
): AsyncResult<
    {
        items: RemoteBmp[];
        nextPageToken: string;
        requestToken: string;
        warnings: LibraryWarning[];
    },
    ServerError
> {
    return Ok(undefined).andThenAsync(async () => {
        let nextPageToken = pageToken;
        const skippedWarnings: LibraryWarning[] = [];

        while (true) {
            const requestToken = nextPageToken;
            if (visited.has(requestToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

            visited.add(requestToken);

            const received = await readLibraryPage(
                requestToken,
                headers,
                fetcher,
                metadata,
                scope,
                lookahead
            ).map((page) => {
                nextPageToken = page.nextPageToken;

                return { ...page, requestToken };
            });
            if (received.isErr()) return received;

            const page = received.unwrap();
            if (page.items.length > 0 || !page.nextPageToken)
                return Ok({
                    ...page,
                    warnings: [...skippedWarnings, ...page.warnings]
                });

            skippedWarnings.push(...page.warnings);
        }
    });
}

export type { ChunkMetadataRecord, ChunkMetadataStore } from './metadata-store';
