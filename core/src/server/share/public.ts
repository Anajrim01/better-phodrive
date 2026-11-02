import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { isCanonicalShareAlbumUrl, ShareShortUrlSchema } from '../../share-models';
import type { Fetcher } from '../fetcher';

const PUBLIC_TIMEOUT_MS = 15_000;
const MAX_PUBLIC_PAGE_CHARS = 3_000_000;
const DIRECT_URL_PATTERN = /https:\/\/lh3\.googleusercontent\.com\/[^"\\\s]+/g;

export type PublicLinkStatus = {
    status: number;
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
            if (!isCanonicalShareAlbumUrl(location)) return Ok({ status, canonicalUrl: null });

            const canonical = await publicFetch(
                fetcher,
                location,
                { method: 'GET', redirect: 'manual' },
                'Read share album'
            );
            if (canonical.isErr()) return Ok({ status, canonicalUrl: null });

            const page = canonical.unwrap();
            const pageStatus = page.status;
            const pageType = page.headers.get('content-type') ?? '';
            cancelBody(page);

            return Ok({
                status: pageStatus,
                canonicalUrl: pageStatus === 200 && pageType.includes('text/html') ? location : null
            });
        }

        return Ok({ status, canonicalUrl: null });
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

            if (probed.isOk() && probed.unwrap().canonicalUrl !== null) return probed;

            if (attempt + 1 < options.attempts) await sleep(options.delayMs);
        }

        return Ok({ status: lastStatus, canonicalUrl: null });
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

        let text: string;
        try {
            text = (await response.text()).slice(0, MAX_PUBLIC_PAGE_CHARS);
        } catch {
            return Err(SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);
        }

        const matches = text.match(DIRECT_URL_PATTERN) ?? [];
        const direct = matches.find((url) => url.length > 0);

        return Ok(direct === undefined ? undefined : withOriginalRendition(direct));
    });
}

function withOriginalRendition(url: string): string {
    const suffix = url.lastIndexOf('=');

    return suffix < 0 ? `${url}=d` : `${url.slice(0, suffix)}=d`;
}

export function probeStopped(
    url: string,
    fetcher: Fetcher
): AsyncResult<number | null, ServerError> {
    return publicFetch(fetcher, url, { method: 'GET', redirect: 'manual' }, 'Verify revocation')
        .map((response) => {
            const status = response.status;
            cancelBody(response);

            return status;
        })
        .mapErr(() => SERVER_ERRORS.SHARE_PUBLIC_PAGE_FAILED);
}
