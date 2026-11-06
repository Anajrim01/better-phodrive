import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { parseAlbumUrl } from './google-listing';

export const PUBLIC_USER_AGENT = 'phodrive-shared/0.1';
// A stalled public read must not hang the caller. Not a size or product limit.
const PUBLIC_TIMEOUT_MS = 15_000;
const STOPPED_STATUSES = new Set([401, 403, 404, 410]);
export const LIVE_STATUSES = new Set([200, 206]);

export type PublicProbe = { status: number; locationHost: string | null; toShare: boolean };
export type ShortUrlStatus = PublicProbe & { canonicalUrl: string | null };
export type PublicState = 'live' | 'stopped' | 'unknown';
// The only path to public URLs, so a public read can never carry owner credentials.
export function publicFetch(
    fetcher: Fetcher,
    url: string,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const response = await fetcher(url, {
                ...init,
                redirect: 'manual',
                signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS)
            });

            return Ok(response);
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: `${stage} failed`, stage } as const);
        }
    });
}

export function cancelBody(response: Response): void {
    void response.body?.cancel().catch(() => undefined);
}

export function requireOk(response: Response, stage: string): Result<Response, ServerError> {
    if (response.status === 200) return Ok(response);

    cancelBody(response);

    return Err({
        code: 'REQUEST_FAILED',
        message: `${stage} failed (HTTP ${response.status})`,
        stage,
        status: response.status
    });
}

export function readProbe(response: Response): PublicProbe {
    const location = response.headers.get('location');
    if (location === null) return { status: response.status, locationHost: null, toShare: false };

    try {
        const url = new URL(location, 'https://photos.google.com');
        const segments = url.pathname.split('/').filter(Boolean);
        const sharePath =
            segments[0] === 'share' || (segments[0] === 'u' && segments[2] === 'share');

        return {
            status: response.status,
            locationHost: url.hostname,
            toShare:
                url.hostname === 'photos.app.goo.gl' ||
                (url.hostname === 'photos.google.com' && sharePath)
        };
    } catch {
        return { status: response.status, locationHost: null, toShare: false };
    }
}

export function probePublicUrl(
    url: string,
    fetcher: Fetcher,
    headers: Record<string, string> = {}
): AsyncResult<PublicProbe, ServerError> {
    return publicFetch(fetcher, url, { method: 'GET', headers }, 'Probe public URL').map(
        (response) => {
            const probe = readProbe(response);
            cancelBody(response);

            return probe;
        }
    );
}

export function classifyPublicProbe(probe: PublicProbe): PublicState {
    if (LIVE_STATUSES.has(probe.status)) return 'live';
    if (STOPPED_STATUSES.has(probe.status)) return 'stopped';

    return 'unknown';
}

export function resolveShortUrl(
    shortUrl: string,
    fetcher: Fetcher
): AsyncResult<ShortUrlStatus, ServerError> {
    return publicFetch(fetcher, shortUrl, { method: 'GET' }, 'Resolve share link').map(
        (response) => {
            const probe = readProbe(response);
            const location = response.headers.get('location');
            cancelBody(response);

            const canonicalUrl = parseAlbumUrl(location ?? '').match<string | null>({
                Ok: (album) => album.canonicalUrl,
                Err: () => null
            });

            return { ...probe, canonicalUrl };
        }
    );
}
