import { Err, Ok, type Result } from 'results-ts';
import { proxyError, type ProxyError } from './errors';
import { MAX_URL_LENGTH } from './limits';

const ALBUM_PATH = /^\/share\/([A-Za-z0-9_-]{10,200})$/;
const CAPABILITY_KEY = /^[A-Za-z0-9_-]{8,500}$/;

export interface AlbumReference {
    uid: string;
    key: string;
    canonical: string;
}

export function parseAlbumUrl(input: string): Result<AlbumReference, ProxyError> {
    if (input.length > MAX_URL_LENGTH) return Err(proxyError('INVALID_ALBUM'));

    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return Err(proxyError('INVALID_ALBUM'));
    }

    if (
        url.protocol !== 'https:' ||
        url.hostname !== 'photos.google.com' ||
        url.port !== '' ||
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== ''
    )
        return Err(proxyError('INVALID_ALBUM'));

    const path = ALBUM_PATH.exec(url.pathname);
    if (!path) return Err(proxyError('INVALID_ALBUM'));

    const keys = url.searchParams.getAll('key');
    if (keys.length !== 1 || !CAPABILITY_KEY.test(keys[0])) return Err(proxyError('INVALID_ALBUM'));

    const uid = path[1];
    const key = keys[0];
    const canonical = `https://photos.google.com/share/${uid}?key=${key}`;

    return Ok({ uid, key, canonical });
}
