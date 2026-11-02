import { Err, Ok, type Result } from 'results-ts';
import { proxyError, type ProxyError } from './errors';
import { MAX_ALBUM_ITEMS } from './limits';
import { parseMediaUrl } from './media-url';

const ITEM_ID = /^[A-Za-z0-9_-]{10,200}$/;

export interface AlbumItem {
    id: string;
    url: string;
    downloadUrl: string;
    width?: number;
    height?: number;
}

export interface AlbumListing {
    title?: string;
    count: number;
    items: AlbumItem[];
}

function itemFromEntry(entry: unknown): Result<AlbumItem, ProxyError> {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !ITEM_ID.test(entry[0]))
        return Err(proxyError('ALBUM_SHAPE_CHANGED'));

    const media = entry[1];
    if (!Array.isArray(media) || typeof media[0] !== 'string')
        return Err(proxyError('ALBUM_SHAPE_CHANGED'));

    return parseMediaUrl(media[0])
        .mapErr(() => proxyError('ALBUM_SHAPE_CHANGED'))
        .map((reference) => {
            const item: AlbumItem = {
                id: entry[0],
                url: reference.url,
                downloadUrl: reference.downloadUrl
            };
            const width = media[1];
            const height = media[2];
            if (Number.isInteger(width) && Number(width) > 0) item.width = Number(width);
            if (Number.isInteger(height) && Number(height) > 0) item.height = Number(height);

            return item;
        });
}

export function parseListingData(data: unknown): Result<AlbumListing, ProxyError> {
    if (!Array.isArray(data)) return Err(proxyError('ALBUM_SHAPE_CHANGED'));

    const entries = data[1];
    const metadata = data[3];
    if (!Array.isArray(entries) || !Array.isArray(metadata))
        return Err(proxyError('ALBUM_SHAPE_CHANGED'));

    const count = metadata[21];
    if (!Number.isInteger(count) || Number(count) < 0 || Number(count) > MAX_ALBUM_ITEMS)
        return Err(proxyError('ALBUM_SHAPE_CHANGED'));
    if (entries.length !== count) return Err(proxyError('ALBUM_INCOMPLETE'));

    const items: AlbumItem[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        const item = itemFromEntry(entry).andThen((value) => {
            if (seen.has(value.id)) return Err(proxyError('ALBUM_SHAPE_CHANGED'));

            seen.add(value.id);
            items.push(value);

            return Ok(undefined);
        });
        if (item.isErr()) return item;
    }

    const listing: AlbumListing = { count: Number(count), items };
    const title = metadata[1];
    if (typeof title === 'string') listing.title = title.slice(0, 200).trim() || undefined;

    return Ok(listing);
}

export function sameListing(first: AlbumListing, second: AlbumListing): boolean {
    if (first.count !== second.count || first.items.length !== second.items.length) return false;

    return first.items.every((item, index) => item.id === second.items[index]?.id);
}
