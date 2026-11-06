import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { MEDIA_HOSTS } from '../download';

const URL_SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ALBUM_PATH = /^\/share\/([A-Za-z0-9_-]+)$/;
const MEDIA_PATH = /^\/(?:pw\/)?[A-Za-z0-9_-]+(?:=d)?$/;
const SERVICE_REQUEST = /id\s*:\s*'([A-Za-z0-9_]+)'\s*,\s*request\s*:\s*(\[[^\]]*\])/g;

// Unconfirmed provider slots: the spike exists to test them against a live album.
const REQUEST_PAGE_TOKEN_SLOT = 1;
const RESPONSE_NEXT_TOKEN_SLOT = 2;
const ITEM_DEDUP_KEY_SLOT = 3;
const RESPONSE_METADATA_SLOT = 3;
const METADATA_COUNT_SLOT = 21;

export type PublicAlbum = { uid: string; key: string; canonicalUrl: string };
export type ListingRequest = { rpcId: string; request: readonly (string | null)[] };
export type PublicItem = {
    id: string;
    downloadUrl: string;
    dedupKey: string | null;
    entry: readonly unknown[];
};
export type ListingPage = {
    count: number;
    items: PublicItem[];
    nextPageToken: string | null;
};

function shapeChanged(): Result<never, ServerError> {
    return Err(SERVER_ERRORS.GOOGLE_LISTING_SHAPE_CHANGED);
}

function asArray(value: unknown): readonly unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function parseJson(text: string): Result<unknown, ServerError> {
    try {
        const parsed: unknown = JSON.parse(text);

        return Ok(parsed);
    } catch {
        return shapeChanged();
    }
}

function secureUrl(input: string, allowedHost: (host: string) => boolean): URL | null {
    let url: URL;

    try {
        url = new URL(input);
    } catch {
        return null;
    }

    const secure =
        url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash;

    return secure && allowedHost(url.hostname) ? url : null;
}

export function parseAlbumUrl(input: string): Result<PublicAlbum, ServerError> {
    const url = secureUrl(input, (host) => host === 'photos.google.com');
    const uid = url && ALBUM_PATH.exec(url.pathname)?.[1];
    const keys = url?.searchParams.getAll('key') ?? [];
    if (!uid || keys.length !== 1 || !URL_SAFE_ID.test(keys[0]))
        return Err(SERVER_ERRORS.GOOGLE_SHARE_LINK_INVALID);

    const key = keys[0];

    return Ok({ uid, key, canonicalUrl: `https://photos.google.com/share/${uid}?key=${key}` });
}

function parseDownloadUrl(input: string): Result<string, ServerError> {
    const url = secureUrl(input, (host) => MEDIA_HOSTS.has(host));
    if (!url || url.search || !MEDIA_PATH.test(url.pathname)) return shapeChanged();

    const base = `${url.origin}${url.pathname}`;

    return Ok(base.endsWith('=d') ? base : `${base}=d`);
}

function parseRequestArray(text: string): (string | null)[] | null {
    const parsed = parseJson(text).match<unknown>({ Ok: (value) => value, Err: () => null });
    const items = asArray(parsed);
    if (!items) return null;

    const request: (string | null)[] = [];
    for (const item of items) {
        if (item !== null && typeof item !== 'string') return null;
        request.push(item);
    }

    return request;
}

export function extractListingRequest(
    html: string,
    album: PublicAlbum
): Result<ListingRequest, ServerError> {
    const matches: ListingRequest[] = [];

    for (const [, rpcId, text] of html.matchAll(SERVICE_REQUEST)) {
        const request = parseRequestArray(text);
        if (request?.[0] === album.uid && request.includes(album.key))
            matches.push({ rpcId, request });
    }

    if (matches.length !== 1) return shapeChanged();
    if (matches[0].request[REQUEST_PAGE_TOKEN_SLOT] !== null)
        return Err(SERVER_ERRORS.GOOGLE_LISTING_PAGINATION_UNKNOWN);

    return Ok(matches[0]);
}

export function pageRequest(
    { request }: ListingRequest,
    pageToken: string | null
): readonly (string | null)[] {
    return request.with(REQUEST_PAGE_TOKEN_SLOT, pageToken);
}

export function parseBatchExecute(text: string, rpcId: string): Result<unknown, ServerError> {
    for (const line of text.split('\n')) {
        if (!line.trimStart().startsWith('[')) continue;

        const parsed = parseJson(line).match<unknown>({ Ok: (value) => value, Err: () => null });
        for (const frame of asArray(parsed) ?? []) {
            const entry = asArray(frame);
            if (entry?.[0] !== 'wrb.fr' || entry[1] !== rpcId) continue;

            return typeof entry[2] === 'string' ? parseJson(entry[2]) : shapeChanged();
        }
    }

    return shapeChanged();
}

function parseItem(value: unknown): Result<PublicItem, ServerError> {
    const entry = asArray(value);
    const id = entry?.[0];
    const url = asArray(entry?.[1])?.[0];
    if (!entry || typeof id !== 'string' || !URL_SAFE_ID.test(id) || typeof url !== 'string')
        return shapeChanged();

    const dedupKey = entry[ITEM_DEDUP_KEY_SLOT];

    return parseDownloadUrl(url).map((downloadUrl) => ({
        id,
        downloadUrl,
        dedupKey: typeof dedupKey === 'string' ? dedupKey : null,
        entry
    }));
}

function parseNextToken(value: unknown): Result<string | null, ServerError> {
    if (value === null || value === undefined) return Ok(null);
    if (typeof value === 'string' && value) return Ok(value);

    return Err(SERVER_ERRORS.GOOGLE_LISTING_PAGINATION_UNKNOWN);
}

export function parseListingPage(data: unknown): Result<ListingPage, ServerError> {
    const page = asArray(data);
    const entries = asArray(page?.[1]);
    const count = asArray(page?.[RESPONSE_METADATA_SLOT])?.[METADATA_COUNT_SLOT];
    if (!page || !entries || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
        return shapeChanged();

    return parseNextToken(page[RESPONSE_NEXT_TOKEN_SLOT]).andThen((nextPageToken) => {
        const items: PublicItem[] = [];
        for (const entry of entries) {
            const item = parseItem(entry).inspect((parsed) => items.push(parsed));
            if (item.isErr()) return item;
        }

        return Ok({ count, items, nextPageToken });
    });
}

export function slotPaths(value: unknown, needle: string, path: readonly number[] = []): string[] {
    if (value === needle) return [path.join('.')];

    return (asArray(value) ?? []).flatMap((child, index) =>
        slotPaths(child, needle, [...path, index])
    );
}
