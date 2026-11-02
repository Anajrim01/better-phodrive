import { Err, Ok, type Result } from 'results-ts';
import { proxyError, type ProxyError } from './errors';
import { MAX_CHUNK_BYTES, MAX_RANGE_BYTES, MAX_URL_LENGTH } from './limits';

const MEDIA_HOST = 'lh3.googleusercontent.com';
const MEDIA_PATH = /^\/(?:pw\/)?[A-Za-z0-9_-]{20,}(?:=d)?$/;
const BYTE_RANGE = /^bytes=(\d{1,12})-(\d{1,12})$/;

function isAllowedMediaUrl(url: URL): boolean {
    return (
        url.protocol === 'https:' &&
        url.hostname === MEDIA_HOST &&
        url.port === '' &&
        url.username === '' &&
        url.password === '' &&
        url.hash === '' &&
        url.search === '' &&
        MEDIA_PATH.test(url.pathname)
    );
}

export interface MediaReference {
    url: string;
    downloadUrl: string;
}

export function parseMediaUrl(input: string): Result<MediaReference, ProxyError> {
    if (input.length > MAX_URL_LENGTH) return Err(proxyError('INVALID_BYTES_URL'));

    let url: URL;
    try {
        url = new URL(input);
    } catch {
        return Err(proxyError('INVALID_BYTES_URL'));
    }

    if (!isAllowedMediaUrl(url)) return Err(proxyError('INVALID_BYTES_URL'));

    const base = url.href;
    const downloadUrl = url.pathname.endsWith('=d') ? base : `${base}=d`;

    return Ok({ url: base, downloadUrl });
}

export function parseRange(input: string | undefined): Result<string, ProxyError> {
    if (input === undefined) return Ok('');

    const match = BYTE_RANGE.exec(input);
    if (!match) return Err(proxyError('INVALID_RANGE'));

    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start)
        return Err(proxyError('INVALID_RANGE'));
    if (start >= MAX_CHUNK_BYTES || end - start + 1 > MAX_RANGE_BYTES)
        return Err(proxyError('INVALID_RANGE'));

    return Ok(`bytes=${start}-${end}`);
}

export { isAllowedMediaUrl };
