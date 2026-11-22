import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { LibraryWarning, RemoteBmp } from '../../../models';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { photosFetch, type Fetcher } from '../../fetcher';
import { MAX_PROVIDER_PAGE_TOKEN_LENGTH, readListingPage } from './listing';
import { scanLibraryPage } from './probe';
import type { ChunkMetadataStore } from './metadata-store';
import { defaultThrottle, type ThrottleScope } from '../throttle';

/** A page of files with a continuation only when another file page exists. */
export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch,
    metadata?: ChunkMetadataStore,
    scope?: ThrottleScope
): AsyncResult<
    {
        items: RemoteBmp[];
        nextPageToken: string;
        warnings: LibraryWarning[];
    },
    ServerError
> {
    const validated =
        pageToken.length > MAX_PROVIDER_PAGE_TOKEN_LENGTH ||
        (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : Ok(pageToken);
    const throttle = scope ?? { key: email, coordinator: defaultThrottle };

    return validated
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher, throttle))
        .andThenAsync((headers) => {
            const visited = new Set<string>();
            return findFilePage(
                pageToken,
                headers,
                fetcher,
                visited,
                metadata,
                throttle
            ).andThenAsync(async ({ items, warnings, nextPageToken }) => {
                if (!nextPageToken) return Ok({ items, warnings, nextPageToken });

                return await findFilePage(
                    nextPageToken,
                    headers,
                    fetcher,
                    visited,
                    metadata,
                    throttle,
                    true
                ).map((next) => ({
                    items,
                    warnings: [...warnings, ...next.warnings],
                    nextPageToken: next.items.length ? next.requestToken : ''
                }));
            });
        });
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

            const received = await readListingPage(requestToken, headers, fetcher, scope)
                .andThenAsync((page) =>
                    scanLibraryPage(page, headers, fetcher, metadata, scope, { lookahead })
                )
                .map((page) => {
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
