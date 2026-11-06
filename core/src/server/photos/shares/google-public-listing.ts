import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { readBody } from '../transport';
import {
    extractListingRequest,
    pageRequest,
    parseBatchExecute,
    parseListingPage,
    type ListingPage,
    type ListingRequest,
    type PublicAlbum,
    type PublicItem
} from './google-listing';
import { publicFetch, PUBLIC_USER_AGENT, requireOk } from './google-public';

const BATCH_EXECUTE_URL = 'https://photos.google.com/_/PhotosUi/data/batchexecute';

export type PublicListing = { count: number; items: PublicItem[]; pages: number };

type ListingWalk = {
    album: PublicAlbum;
    listing: ListingRequest;
    fetcher: Fetcher;
    items: PublicItem[];
    ids: Set<string>;
    tokens: Set<string>;
    pages: number;
};

function readListingPage(walk: ListingWalk, token: string | null) {
    const stage = 'Read album listing';
    const url = new URL(BATCH_EXECUTE_URL);
    url.searchParams.set('rpcids', walk.listing.rpcId);
    url.searchParams.set('source-path', `/share/${walk.album.uid}`);
    url.searchParams.set('hl', 'en');

    const frame = [
        [[walk.listing.rpcId, JSON.stringify(pageRequest(walk.listing, token)), null, 'generic']]
    ];

    return publicFetch(
        walk.fetcher,
        url.href,
        {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'user-agent': PUBLIC_USER_AGENT
            },
            body: new URLSearchParams({ 'f.req': JSON.stringify(frame) })
        },
        stage
    )
        .andThen((response) => requireOk(response, stage))
        .andThenAsync((response) => readBody(response, stage))
        .andThen((body) => parseBatchExecute(body.toString('utf8'), walk.listing.rpcId))
        .andThen(parseListingPage);
}

function addPage(walk: ListingWalk, page: ListingPage): Result<void, ServerError> {
    for (const item of page.items) {
        if (walk.ids.has(item.id)) return Err(SERVER_ERRORS.GOOGLE_LISTING_SHAPE_CHANGED);

        walk.ids.add(item.id);
        walk.items.push(item);
    }

    walk.pages += 1;

    return Ok(undefined);
}

function walkPages(
    walk: ListingWalk,
    token: string | null
): AsyncResult<PublicListing, ServerError> {
    return readListingPage(walk, token).andThenAsync(async (page) => {
        const added = addPage(walk, page);
        if (added.isErr()) return added;

        const { nextPageToken } = page;
        if (nextPageToken === null)
            return walk.items.length === page.count
                ? Ok({ count: page.count, items: walk.items, pages: walk.pages })
                : Err(SERVER_ERRORS.GOOGLE_LISTING_INCOMPLETE);

        if (walk.tokens.has(nextPageToken) || !page.items.length)
            return Err(SERVER_ERRORS.GOOGLE_LISTING_PAGINATION_UNKNOWN);

        walk.tokens.add(nextPageToken);

        return walkPages(walk, nextPageToken);
    });
}

export function readPublicListing(
    album: PublicAlbum,
    fetcher: Fetcher
): AsyncResult<PublicListing, ServerError> {
    const stage = 'Read album page';

    return publicFetch(
        fetcher,
        album.canonicalUrl,
        {
            method: 'GET',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': PUBLIC_USER_AGENT
            }
        },
        stage
    )
        .andThen((response) => requireOk(response, stage))
        .andThenAsync((response) => readBody(response, stage))
        .andThen((body) => extractListingRequest(body.toString('utf8'), album))
        .andThenAsync((listing) =>
            walkPages(
                {
                    album,
                    listing,
                    fetcher,
                    items: [],
                    ids: new Set(),
                    tokens: new Set(),
                    pages: 0
                },
                null
            )
        );
}
