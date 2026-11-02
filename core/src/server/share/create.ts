import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { photosFetch, type Fetcher } from '../fetcher';
import { createShareAlbum, removeShareAlbum } from '../photos/albums';
import { alreadyGone, createEnvelope, deleteEnvelope } from './envelope';
import {
    ShareCreateRequestSchema,
    type ShareCreateRequest,
    type ShareCreateResponse,
    type ShareManifestFile
} from '../../share-models';
import { LINK_STATE_DISABLED } from './requests';
import { enableShareLink, updateLinkState } from './link';
import { buildShareUrl, manifestFile } from './manifest';
import type { PollOptions } from './public';
import { recoveryError } from './recovery';
import { resumeShare } from './resume';

const DEFAULT_POLL: PollOptions = { attempts: 30, delayMs: 1000 };
const DEFAULT_RETRY_DELAY_MS = 2000;

export type ShareCreateOptions = {
    poll?: Partial<PollOptions>;
    retryDelayMs?: number;
    now?: () => number;
};

export function createShare(
    input: ShareCreateRequest,
    fetcher: Fetcher = photosFetch,
    options: ShareCreateOptions = {}
): AsyncResult<ShareCreateResponse, ServerError> {
    const parsed = ShareCreateRequestSchema.safeParse(input);
    if (!parsed.success)
        return Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Invalid share request' } as const)
        );

    return Ok(undefined).andThenAsync<ShareCreateResponse, ServerError>(async () => {
        const request = parsed.data;
        const poll = { ...DEFAULT_POLL, ...options.poll };

        if (request.existing !== undefined)
            return await resumeShare(request, fetcher, {
                poll,
                retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
                now: options.now ?? Date.now
            });

        const files = (request.files ?? []).map(manifestFile);
        return await createDedicatedShare(request, files, fetcher, poll, options);
    });
}

async function createDedicatedShare(
    request: ShareCreateRequest,
    files: ShareManifestFile[],
    fetcher: Fetcher,
    poll: PollOptions,
    options: ShareCreateOptions
): Promise<AsyncResult<ShareCreateResponse, ServerError>> {
    const album = await createShareAlbum(
        request.email,
        request.token,
        request.name,
        mediaKeys(request),
        fetcher
    );
    const albumError = album.match({ Ok: () => null, Err: (error) => error });
    if (albumError !== null) return Err(albumError);

    const albumKey = album.match({ Ok: (key) => key, Err: () => '' });
    const envelope = await createEnvelope(
        request.email,
        request.token,
        albumKey,
        request.name,
        fetcher
    );
    const envelopeError = envelope.match({ Ok: () => null, Err: (error) => error });
    if (envelopeError !== null) {
        const clean = await removeCreatedAlbum(request, albumKey, fetcher);
        if (!clean) return Err(recoveryError(undefined, albumKey));

        return Err(envelopeError);
    }

    const created = envelope.match({ Ok: (value) => value, Err: () => null });
    if (created === null) return Err(SERVER_ERRORS.SHARE_ENVELOPE_RESPONSE_FAILED);

    const link = await enableShareLink(
        request.email,
        request.token,
        created.envelopeKey,
        created.pendingShortUrl,
        undefined,
        fetcher,
        { poll, retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS }
    );
    const linked = link.match({ Ok: (value) => value, Err: () => null });
    if (linked === null) {
        const clean = await cleanup(request, created.envelopeKey, albumKey, true, true, fetcher);
        if (!clean) return Err(recoveryError(created.envelopeKey, albumKey));

        const linkError = link.match({ Ok: () => null, Err: (error) => error });
        if (linkError !== null && linkError.code === 'SHARE_LINK_UNCERTAIN')
            return Err(recoveryError(created.envelopeKey, albumKey));
        if (linkError !== null) return Err(linkError);

        return Err(SERVER_ERRORS.SHARE_LINK_UNCERTAIN);
    }

    const manifest = { v: 1 as const, album: linked.canonicalUrl, files };
    const shareUrl = buildShareUrl(manifest);
    const createdUrl = shareUrl.match({ Ok: (value) => value, Err: () => '' });
    if (createdUrl === '') {
        const clean = await cleanup(request, created.envelopeKey, albumKey, true, true, fetcher);
        if (!clean) return Err(recoveryError(created.envelopeKey, albumKey));

        const shareError = shareUrl.match({ Ok: () => null, Err: (error) => error });
        if (shareError !== null) return Err(shareError);

        return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);
    }

    return Ok({
        record: {
            name: request.name,
            envelopeKey: created.envelopeKey,
            albumKey,
            shortUrl: linked.shortUrl,
            albumUrl: linked.canonicalUrl,
            authKey: linked.authKey,
            shareUrl: createdUrl,
            createdAt: (options.now ?? Date.now)()
        },
        manifest
    });
}

function mediaKeys(request: ShareCreateRequest): string[] {
    return (request.files ?? []).flatMap((file) => file.chunks.map((chunk) => chunk.mediaKey));
}

async function removeCreatedAlbum(
    request: ShareCreateRequest,
    albumKey: string,
    fetcher: Fetcher
): Promise<boolean> {
    const album = await removeShareAlbum(request.email, request.token, albumKey, fetcher);
    const error = album.match({ Ok: () => null, Err: (value) => value });

    return error === null || alreadyGone(error);
}

async function cleanup(
    request: ShareCreateRequest,
    envelopeKey: string,
    albumKey: string,
    createdEnvelope: boolean,
    createdAlbum: boolean,
    fetcher: Fetcher
): Promise<boolean> {
    let clean = true;

    const disabled = await updateLinkState(
        request.email,
        request.token,
        envelopeKey,
        LINK_STATE_DISABLED,
        fetcher
    );
    const disableError = disabled.match({ Ok: () => null, Err: (error) => error });
    if (disableError !== null && !alreadyGone(disableError)) clean = false;

    if (createdEnvelope) {
        const envelope = await deleteEnvelope(request.email, request.token, envelopeKey, fetcher);
        const envelopeError = envelope.match({ Ok: () => null, Err: (error) => error });
        if (envelopeError !== null && !alreadyGone(envelopeError)) clean = false;
    }

    if (createdAlbum && !(await removeCreatedAlbum(request, albumKey, fetcher))) clean = false;

    return clean;
}
