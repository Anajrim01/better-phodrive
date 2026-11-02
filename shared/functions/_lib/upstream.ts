import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ProxyError } from './errors';
import { MAX_ALBUM_CONCURRENCY } from './limits';

let activeAlbumRequests = 0;

export function acquireAlbumSlot(): boolean {
    if (activeAlbumRequests >= MAX_ALBUM_CONCURRENCY) return false;

    activeAlbumRequests++;

    return true;
}

export function releaseAlbumSlot(): void {
    activeAlbumRequests = Math.max(0, activeAlbumRequests - 1);
}

export function fetchWithTimeout(
    fetchImpl: typeof fetch,
    url: string,
    init: RequestInit,
    timeoutMs: number,
    failure: ProxyError
): AsyncResult<Response, ProxyError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const response = await fetchImpl(url, {
                ...init,
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs)
            });

            return Ok(response);
        } catch {
            return Err(failure);
        }
    });
}
