import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { isCanonicalShareAlbumUrl, ShareShortUrlSchema } from '../../share-models';
import type { Fetcher } from '../fetcher';

const PUBLIC_TIMEOUT_MS = 15_000;
const MAX_PUBLIC_PAGE_CHARS = 3_000_000;
const DIRECT_URL_PATTERN = /https:\/\/lh3\.googleusercontent\.com\/[^"\\\s]+/g;
const STOPPED_STATUSES = new Set([401, 403, 404, 410]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type PublicProbe = {
    status: number | null;
    location: string | null;
};

export type PublicLinkStatus = {
    status: number;
    location: string | null;
    canonicalUrl: string | null;
};

export type PollOptions = {
    attempts: number;
    delayMs: number;
    sleep?: (milliseconds: number) => Promise<void>;
};

function defaultSleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicFetch(
    fetcher: Fetcher,
    url: string,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const response = await fetcher(url, {
                ...init,
                signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS)
            });

            return Ok(response);
        } catch {
            return Err({
                code: 'REQUEST_FAILED',
                message: `${stage} failed`,
                stage
            } as const);
        }
    });
}

function cancelBody(response: Response): void {
    void response.body?.cancel().catch(() => undefined);
}

function pointsToShare(location: string): boolean {
    let url: URL;

    try {
        url = new URL(location, 'https://photos.google.com');
    } catch {
        return false;
    }

    if (url.hostname === 'photos.app.goo.gl') return true;
    if (url.hostname !== 'photos.google.com') return false;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'share') return true;

    return segments[0] === 'u' && /^\d+$/.test(segments[1] ?? '') && segments[2] === 'share';
}

export function isStoppedProbe(probe: PublicProbe): boolean {
    if (probe.status === null || probe.status === 200) return false;
    if (STOPPED_STATUSES.has(probe.status)) return true;
    if (!REDIRECT_STATUSES.has(probe.status)) return false;

    return probe.location !== null && !pointsToShare(probe.location);
}

export function probeShortUrl(
    shortUrl: string,
    fetcher: Fetcher
): AsyncResult<PublicLinkStatus, ServerError> {
    const parsed = ShareShortUrlSchema.safeParse(shortUrl);
    if (!parsed.success)
        return Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.SHARE_LINK_RESOLVE_FAILED));

    return publicFetch(
        fetcher,
        parsed.data,
        { method: 'GET', redirect: 'manual' },
        'Resolve share link'
    ).andThenAsync(async (response) => {
        const location = response.headers.get('location');
        const status = response.status;
        cancelBody(response);

        if (status >= 300 && status < 400 && location !== null) {
            if (!isCanonicalShareAlbumUrl(location))
                return Ok<PublicLinkStatus>({ status, canonicalUrl: null, location });

            const canonical = await publicFetch(
                fetcher,
                location,
                { method: 'GET', redirect: 'manual' },
                'Read share album'
            );
            const page = canonical.match({ Ok: (value) => value, Err: () => null });
            if (page === null) return Err(SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);

            const pageStatus = page.status;
            const pageType = page.headers.get('content-type') ?? '';
            cancelBody(page);

            return Ok<PublicLinkStatus>({
                status: pageStatus,
                canonicalUrl:
                    pageStatus === 200 && pageType.includes('text/html') ? location : null,
                location
            });
        }

        return Ok<PublicLinkStatus>({ status, canonicalUrl: null, location: null });
    });
}

export function waitForLiveShortUrl(
    shortUrl: string,
    fetcher: Fetcher,
    options: PollOptions
): AsyncResult<PublicLinkStatus, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const sleep = options.sleep ?? defaultSleep;
        let lastStatus = 0;

        for (let attempt = 0; attempt < options.attempts; attempt++) {
            const probed = await probeShortUrl(shortUrl, fetcher);
            probed.inspect((result) => {
                lastStatus = result.status;
            });

            const result = probed.match({ Ok: (value) => value, Err: () => null });
            if (result !== null && result.canonicalUrl !== null) return probed;

            if (attempt + 1 < options.attempts) await sleep(options.delayMs);
        }

        return Ok<PublicLinkStatus>({ status: lastStatus, canonicalUrl: null, location: null });
    });
}

export function readFirstDirectUrl(
    shortUrl: string,
    fetcher: Fetcher
): AsyncResult<string | undefined, ServerError> {
    return publicFetch(
        fetcher,
        shortUrl,
        { method: 'GET', redirect: 'follow' },
        'Read public share page'
    ).andThenAsync(async (response) => {
        if (response.status !== 200) {
            cancelBody(response);

            return Ok(undefined);
        }

        const text = (await readLimitedText(response)).match({
            Ok: (value) => value,
            Err: () => null
        });
        if (text === null) return Err(SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);

        const matches = text.match(DIRECT_URL_PATTERN) ?? [];
        const direct = matches.find((url) => url.length > 0);

        return Ok(direct === undefined ? undefined : withOriginalRendition(direct));
    });
}

async function readLimitedText(response: Response): Promise<Result<string, ServerError>> {
    const reader = response.body?.getReader();
    if (reader === undefined) return Ok('');

    const decoder = new TextDecoder();
    let text = '';

    try {
        while (text.length < MAX_PUBLIC_PAGE_CHARS) {
            const chunk = await reader.read();
            if (chunk.done) break;

            text += decoder.decode(chunk.value, { stream: true });
        }

        text += decoder.decode();

        if (text.length >= MAX_PUBLIC_PAGE_CHARS) await reader.cancel();

        return Ok(text.slice(0, MAX_PUBLIC_PAGE_CHARS));
    } catch {
        try {
            await reader.cancel();
        } catch {
            /* The body is already failing. */
        }

        return Err(SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);
    }
}

function withOriginalRendition(url: string): string {
    const suffix = url.lastIndexOf('=');

    return suffix < 0 ? `${url}=d` : `${url.slice(0, suffix)}=d`;
}

export function probeStopped(url: string, fetcher: Fetcher): AsyncResult<PublicProbe, ServerError> {
    return publicFetch(fetcher, url, { method: 'GET', redirect: 'manual' }, 'Verify revocation')
        .map((response) => {
            const status = response.status;
            const location = response.headers.get('location');
            cancelBody(response);

            return { status, location };
        })
        .mapErr(() => SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);
}
