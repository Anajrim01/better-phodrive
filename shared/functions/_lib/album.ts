import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import { parseAlbumUrl, type AlbumReference } from './album-url';
import { proxyError, type ProxyError } from './errors';
import { errorResponse, jsonResponse, readCappedText, readJsonBody } from './http';
import { parseListingData, sameListing, type AlbumListing } from './listing-data';
import {
    extractInitDataCallbacks,
    extractServiceRequests,
    pickServiceRequest,
    type InitDataCallback
} from './listing-html';
import { parseBatchExecute } from './listing-rpc';
import { MAX_ALBUM_JSON_BYTES, MAX_ALBUM_PAGE_BYTES, UPSTREAM_TIMEOUT_MS } from './limits';
import { acquireAlbumSlot, fetchWithTimeout, releaseAlbumSlot } from './upstream';

const AlbumRequestSchema = z.object({ album: z.string() }).strict();
const PAGE_ORIGIN = 'https://photos.google.com';
const USER_AGENT = 'phodrive-shared/0.1';

export interface AlbumDeps {
    fetch: typeof fetch;
    pageOrigin: string;
}

export interface AlbumResult {
    title?: string;
    count: number;
    items: AlbumListing['items'];
}

const DEFAULT_DEPS: AlbumDeps = {
    fetch: globalThis.fetch.bind(globalThis),
    pageOrigin: PAGE_ORIGIN
};

function fetchAlbumPage(
    reference: AlbumReference,
    deps: AlbumDeps
): AsyncResult<string, ProxyError> {
    const url = new URL(`/share/${reference.uid}`, deps.pageOrigin);
    url.searchParams.set('key', reference.key);

    return fetchWithTimeout(
        deps.fetch,
        url.href,
        {
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'accept-language': 'en-US,en;q=0.9',
                'user-agent': USER_AGENT
            }
        },
        UPSTREAM_TIMEOUT_MS,
        proxyError('UPSTREAM_UNAVAILABLE')
    )
        .andThen((response) => {
            if (response.status === 404 || response.status === 410)
                return Err(proxyError('ALBUM_UNAVAILABLE'));
            if (response.status !== 200) return Err(proxyError('UPSTREAM_STATUS'));

            const type = response.headers.get('content-type') ?? '';
            if (!type.includes('text/html')) return Err(proxyError('ALBUM_SHAPE_CHANGED'));

            return Ok(response);
        })
        .andThenAsync((response) => readCappedText(response, MAX_ALBUM_PAGE_BYTES));
}

function callListingRpc(
    reference: AlbumReference,
    rpcId: string,
    request: (string | null)[],
    deps: AlbumDeps
): AsyncResult<unknown, ProxyError> {
    const url = new URL('/_/PhotosUi/data/batchexecute', deps.pageOrigin);
    url.searchParams.set('rpcids', rpcId);
    url.searchParams.set('source-path', `/share/${reference.uid}`);
    url.searchParams.set('hl', 'en');

    const form = new URLSearchParams({
        'f.req': JSON.stringify([[[rpcId, JSON.stringify(request), null, 'generic']]])
    });

    return fetchWithTimeout(
        deps.fetch,
        url.href,
        {
            method: 'POST',
            headers: {
                accept: '*/*',
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'user-agent': USER_AGENT
            },
            body: form
        },
        UPSTREAM_TIMEOUT_MS,
        proxyError('UPSTREAM_UNAVAILABLE')
    )
        .andThen((response) =>
            response.status === 200 ? Ok(response) : Err(proxyError('UPSTREAM_STATUS'))
        )
        .andThenAsync((response) => readCappedText(response, MAX_ALBUM_JSON_BYTES))
        .andThen((text) => parseBatchExecute(text, rpcId));
}

function parseCallbacks(callbacks: InitDataCallback[]): Result<AlbumListing, ProxyError> {
    const listings: AlbumListing[] = [];
    let incomplete = false;

    for (const callback of callbacks) {
        parseListingData(callback.data).match({
            Ok: (listing) => {
                listings.push(listing);

                return undefined;
            },
            Err: (error) => {
                if (error.code === 'ALBUM_INCOMPLETE') incomplete = true;

                return undefined;
            }
        });
    }

    if (listings.length === 0)
        return Err(proxyError(incomplete ? 'ALBUM_INCOMPLETE' : 'ALBUM_SHAPE_CHANGED'));

    const first = listings[0];
    if (!listings.every((listing) => sameListing(first, listing)))
        return Err(proxyError('ALBUM_MISMATCH'));

    return Ok(first);
}

function readListing(
    html: string,
    reference: AlbumReference,
    deps: AlbumDeps
): AsyncResult<AlbumListing, ProxyError> {
    return extractServiceRequests(html).andThenAsync(async (entries) => {
        const fallback = parseCallbacks(extractInitDataCallbacks(html));
        const service = pickServiceRequest(entries, reference.uid, reference.key);
        if (!service) return fallback;

        const rpc = await callListingRpc(reference, service.id, service.request, deps);
        return rpc.match({
            Err: (error) => (fallback.isErr() ? Err(error) : fallback),
            Ok: (data) =>
                parseListingData(data).match({
                    Err: (error) => Err(error),
                    Ok: (primary) =>
                        fallback.match({
                            Err: () => Ok(primary),
                            Ok: (other) =>
                                sameListing(primary, other)
                                    ? Ok(primary)
                                    : Err(proxyError('ALBUM_MISMATCH'))
                        })
                })
        });
    });
}

async function serveAlbum(reference: AlbumReference, deps: AlbumDeps): Promise<Response> {
    if (!acquireAlbumSlot()) return errorResponse(proxyError('BUSY'));

    try {
        const page = await fetchAlbumPage(reference, deps);
        return page.match({
            Err: async (error) => errorResponse(error),
            Ok: async (html) => {
                const listing = await readListing(html, reference, deps);
                return listing.match({
                    Err: errorResponse,
                    Ok: (value) => {
                        const result: AlbumResult = { count: value.count, items: value.items };
                        if (value.title) result.title = value.title;

                        return jsonResponse(result);
                    }
                });
            }
        });
    } finally {
        releaseAlbumSlot();
    }
}

export async function handleAlbum(
    request: Request,
    deps: AlbumDeps = DEFAULT_DEPS
): Promise<Response> {
    const body = await readJsonBody(request, AlbumRequestSchema);
    return body.match({
        Err: async (error) => errorResponse(error),
        Ok: async (value) =>
            parseAlbumUrl(value.album).match({
                Err: async (error) => errorResponse(error),
                Ok: (reference) => serveAlbum(reference, deps)
            })
    });
}
