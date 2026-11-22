import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    MAX_LIBRARY_BATCH_PAGES,
    type LibraryResponse,
    type LibraryWarning
} from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { authenticatedHeaders, type PhotosHeaders } from '../auth';
import { defaultThrottle, type ThrottleScope } from '../throttle';
import { MAX_PROVIDER_PAGE_TOKEN_LENGTH, readListingPage } from './listing';
import type { LibraryCandidate } from './metadata';
import type { ChunkMetadataStore } from './metadata-store';
import { scanLibraryPage } from './probe';

const MAX_COLD_PROBES = 16;

type Cursor = { token: string; resume?: { digest: string; offset: number } };
type DrivePages = LibraryResponse & {
    pageTokens: string[];
    providerPages: number;
    warnings: LibraryWarning[];
};
type ScannedPage = LibraryResponse & { warnings: LibraryWarning[]; probeGroups: number };

function decodeCursor(value: string): Result<Cursor, ServerError> {
    if (value.length > MAX_PROVIDER_PAGE_TOKEN_LENGTH + 54)
        return Err(SERVER_ERRORS.INVALID_PAGE_TOKEN);

    const match = /^([A-Za-z0-9_-]*)(?:\.([A-Za-z0-9_-]{43})\.([1-9][0-9]{0,8}))?$/.exec(value);
    if (!match || match[1].length > MAX_PROVIDER_PAGE_TOKEN_LENGTH)
        return Err(SERVER_ERRORS.INVALID_PAGE_TOKEN);

    const [, token, digest, offset] = match;
    return Ok(digest ? { token, resume: { digest, offset: Number(offset) } } : { token });
}

function listingDigest(items: readonly LibraryCandidate[]): string {
    return createHash('sha256')
        .update(JSON.stringify(items.map(({ mediaKey }) => mediaKey)))
        .digest('base64url');
}

function scanDrivePage(
    cursor: Cursor,
    headers: PhotosHeaders,
    fetcher: Fetcher,
    metadata: ChunkMetadataStore | undefined,
    scope: ThrottleScope,
    remainingProbes: number
): AsyncResult<ScannedPage, ServerError> {
    return readListingPage(cursor.token, headers, fetcher, scope).andThenAsync<
        ScannedPage,
        ServerError
    >(async (page) => {
        const offset = cursor.resume?.offset ?? 0;
        if (
            cursor.resume &&
            (offset >= page.items.length || cursor.resume.digest !== listingDigest(page.items))
        ) {
            return Err(SERVER_ERRORS.LIBRARY_PAGE_CHANGED);
        }

        return await scanLibraryPage(page, headers, fetcher, metadata, scope, {
            offset,
            maxProbes: remainingProbes
        }).map(({ items, warnings, candidatesScanned, probeGroups }) => {
            const nextOffset = offset + candidatesScanned;
            // A cursor inside a listing is valid only while that listing stays in the same order.
            const nextPageToken =
                nextOffset < page.items.length
                    ? `${cursor.token}.${listingDigest(page.items)}.${nextOffset}`
                    : page.nextPageToken;
            return { items, warnings, nextPageToken, probeGroups };
        });
    });
}

/** Bound both listing calls and cold probes before returning control to the browser. */
export function listDrivePages(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch,
    metadata?: ChunkMetadataStore,
    scope?: ThrottleScope,
    pageCount = 1
): AsyncResult<DrivePages, ServerError> {
    const throttle = scope ?? { key: email, coordinator: defaultThrottle };
    const depth = Math.min(pageCount, MAX_LIBRARY_BATCH_PAGES);

    return decodeCursor(pageToken).andThenAsync((cursor) =>
        authenticatedHeaders(email, token, fetcher, throttle).andThenAsync(async (headers) => {
            const snapshot: DrivePages = {
                items: [],
                warnings: [],
                pageTokens: [],
                providerPages: 0,
                nextPageToken: ''
            };
            let requestToken = pageToken;
            let current = cursor;
            let remainingProbes = MAX_COLD_PROBES;

            for (let page = 0; page < depth; page++) {
                const result = await scanDrivePage(
                    current,
                    headers,
                    fetcher,
                    metadata,
                    throttle,
                    remainingProbes
                ).andThen(({ items, warnings, nextPageToken, probeGroups }) => {
                    snapshot.pageTokens.push(requestToken);
                    if (!current.resume) snapshot.providerPages++;
                    if (nextPageToken && snapshot.pageTokens.includes(nextPageToken))
                        return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

                    snapshot.items.push(...items);
                    snapshot.warnings.push(...warnings);
                    snapshot.nextPageToken = nextPageToken;
                    remainingProbes -= probeGroups;
                    return Ok(undefined);
                });
                if (result.isErr()) return result;
                if (!snapshot.nextPageToken || remainingProbes === 0) break;

                requestToken = snapshot.nextPageToken;
                current = { token: requestToken };
            }

            // An empty terminal sync page does not need a Load more action.
            if (
                snapshot.nextPageToken &&
                !snapshot.nextPageToken.includes('.') &&
                remainingProbes > 0 &&
                snapshot.pageTokens.length < MAX_LIBRARY_BATCH_PAGES
            ) {
                const tail = await readListingPage(
                    snapshot.nextPageToken,
                    headers,
                    fetcher,
                    throttle
                );
                tail.inspect(({ items, warnings, nextPageToken }) => {
                    if (!items.length && !warnings.length && !nextPageToken)
                        snapshot.nextPageToken = '';
                });
            }

            snapshot.partial = snapshot.nextPageToken.includes('.');
            return Ok(snapshot);
        })
    );
}
