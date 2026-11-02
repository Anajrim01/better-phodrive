import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Fetcher } from '../fetcher';
import { authenticatedHeaders } from '../photos/auth';
import { guardedSend, readBody } from '../photos/transport';
import { bodyBytes } from '../protobuf';
import {
    LINK_STATE_DISABLED,
    LINK_STATE_ENABLED,
    linkStateRequest,
    parseLinkStateResponse,
    UPDATE_LINK_STATE_URL
} from './requests';
import { waitForLiveShortUrl, type PollOptions } from './public';

export type ShareLink = {
    shortUrl: string;
    authKey: string;
    canonicalUrl: string;
};

export type PreviousLink = {
    shortUrl?: string;
    authKey?: string;
};

export type EnableOptions = {
    poll: PollOptions;
    retryDelayMs?: number;
};

function ambiguous(error: ServerError): boolean {
    return (
        error.code === 'THROTTLED' ||
        (error.code === 'REQUEST_FAILED' && (error.status === undefined || error.status >= 500))
    );
}

export function updateLinkState(
    email: string,
    token: string,
    envelopeKey: string,
    state: typeof LINK_STATE_ENABLED | typeof LINK_STATE_DISABLED,
    fetcher: Fetcher
): AsyncResult<{ shortUrl: string; authKey: string } | null, ServerError> {
    const request = linkStateRequest(envelopeKey, state);

    return authenticatedHeaders(email, token, fetcher).andThenAsync(({ rpcHeaders }) =>
        guardedSend(
            email,
            fetcher,
            UPDATE_LINK_STATE_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: rpcHeaders,
                body: bodyBytes(request)
            },
            state === LINK_STATE_ENABLED ? 'Enable share link' : 'Disable share link'
        ).andThenAsync((response) =>
            readBody(response, 'Share link state').andThen((body) =>
                state === LINK_STATE_ENABLED
                    ? parseLinkStateResponse(body).map((link) => link)
                    : Ok(null)
            )
        )
    );
}

async function canonicalLink(
    link: { shortUrl: string; authKey: string },
    fetcher: Fetcher,
    poll: PollOptions
): Promise<AsyncResult<ShareLink, ServerError>> {
    const live = await waitForLiveShortUrl(link.shortUrl, fetcher, poll);
    if (live.isErr()) return live;

    const status = live.unwrap();
    if (status.canonicalUrl === null) return Err(SERVER_ERRORS.SHARE_LINK_NOT_LIVE);

    return Ok({
        shortUrl: link.shortUrl,
        authKey: link.authKey,
        canonicalUrl: status.canonicalUrl
    });
}

async function retryEnable(
    email: string,
    token: string,
    envelopeKey: string,
    first: { shortUrl: string; authKey: string },
    fetcher: Fetcher,
    options: EnableOptions
): Promise<AsyncResult<ShareLink, ServerError>> {
    const sleep =
        options.poll.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    await sleep(options.retryDelayMs ?? 2000);

    const second = await updateLinkState(email, token, envelopeKey, LINK_STATE_ENABLED, fetcher);
    if (second.isErr()) {
        const error = second.unwrapErr();

        return ambiguous(error) ? Err(SERVER_ERRORS.SHARE_LINK_UNCERTAIN) : Err(error);
    }

    const link = second.unwrap();
    if (link === null) return Err(SERVER_ERRORS.SHARE_LINK_RESPONSE_FAILED);
    if (link.shortUrl === first.shortUrl) {
        return canonicalLink(link, fetcher, {
            ...options.poll,
            attempts: Math.max(1, Math.min(3, options.poll.attempts))
        });
    }

    const current = await canonicalLink(link, fetcher, options.poll);
    if (current.isOk()) return current;

    const previousLive = await canonicalLink(first, fetcher, {
        ...options.poll,
        attempts: Math.max(1, Math.min(3, options.poll.attempts))
    });

    return previousLive.isOk() ? previousLive : current;
}

export function enableShareLink(
    email: string,
    token: string,
    envelopeKey: string,
    previous: PreviousLink | undefined,
    fetcher: Fetcher,
    options: EnableOptions
): AsyncResult<ShareLink, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        if (previous?.shortUrl !== undefined && previous.authKey !== undefined) {
            const existing = await canonicalLink(
                { shortUrl: previous.shortUrl, authKey: previous.authKey },
                fetcher,
                options.poll
            );
            if (existing.isOk()) return existing;
        }

        const first = await updateLinkState(email, token, envelopeKey, LINK_STATE_ENABLED, fetcher);
        if (first.isErr())
            return ambiguous(first.unwrapErr()) ? Err(SERVER_ERRORS.SHARE_LINK_UNCERTAIN) : first;

        const link = first.unwrap();
        if (link === null) return Err(SERVER_ERRORS.SHARE_LINK_RESPONSE_FAILED);

        const live = await canonicalLink(link, fetcher, options.poll);
        if (live.isOk()) return live;

        return await retryEnable(email, token, envelopeKey, link, fetcher, options);
    });
}
