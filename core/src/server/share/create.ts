import { SERVER_ERRORS, type ServerError, type ShareRecovery } from '../errors';
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
import { buildShareUrl, decodeShareUrl, manifestFile } from './manifest';
import type { PollOptions } from './public';

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
        const files = request.files.map(manifestFile);
        const reuseError = existingShareError(request, files);
        if (reuseError !== null) return Err(reuseError);

        const poll = { ...DEFAULT_POLL, ...options.poll };
        let albumKey = request.existing?.albumKey;
        let createdAlbum = false;

        if (albumKey === undefined) {
            const album = await createShareAlbum(
                request.email,
                request.token,
                request.name,
                mediaKeys(request),
                fetcher
            );
            const albumError = album.match({ Ok: () => null, Err: (error) => error });
            if (albumError !== null) return Err(albumError);

            albumKey = album.match({ Ok: (key) => key, Err: () => '' });
            createdAlbum = true;
        }

        let envelopeKey = request.existing?.envelopeKey;
        let pendingShortUrl: string | undefined;
        let createdEnvelope = false;
        if (envelopeKey === undefined) {
            const envelope = await createEnvelope(
                request.email,
                request.token,
                albumKey,
                request.name,
                fetcher
            );
            const envelopeError = envelope.match({ Ok: () => null, Err: (error) => error });
            if (envelopeError !== null) {
                if (createdAlbum)
                    await removeShareAlbum(request.email, request.token, albumKey, fetcher);

                return Err(envelopeError);
            }

            const created = envelope.match({ Ok: (value) => value, Err: () => null });
            if (created === null) return Err(SERVER_ERRORS.SHARE_ENVELOPE_RESPONSE_FAILED);

            envelopeKey = created.envelopeKey;
            pendingShortUrl = created.pendingShortUrl;
            createdEnvelope = true;
        }

        const link = await enableShareLink(
            request.email,
            request.token,
            envelopeKey,
            pendingShortUrl,
            request.existing,
            fetcher,
            { poll, retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS }
        );
        const linked = link.match({ Ok: (value) => value, Err: () => null });
        if (linked === null) {
            if (createdEnvelope || createdAlbum) {
                const clean = await cleanup(
                    request,
                    envelopeKey,
                    albumKey,
                    createdEnvelope,
                    createdAlbum,
                    fetcher
                );
                if (!clean) return Err(recoveryError(envelopeKey, albumKey));
            }

            const linkError = link.match({ Ok: () => null, Err: (error) => error });
            if (linkError !== null && linkError.code === 'SHARE_LINK_UNCERTAIN')
                return Err(recoveryError(envelopeKey, albumKey));
            if (linkError !== null) return Err(linkError);

            return Err(SERVER_ERRORS.SHARE_LINK_UNCERTAIN);
        }

        const manifest = {
            v: 1 as const,
            album: linked.canonicalUrl,
            files
        };
        const shareUrl = buildShareUrl(manifest);
        const createdUrl = shareUrl.match({ Ok: (value) => value, Err: () => '' });
        if (createdUrl === '') {
            const clean = await cleanup(
                request,
                envelopeKey,
                albumKey,
                createdEnvelope,
                createdAlbum,
                fetcher
            );
            if (!clean) return Err(recoveryError(envelopeKey, albumKey));

            const shareError = shareUrl.match({ Ok: () => null, Err: (error) => error });
            if (shareError !== null) return Err(shareError);

            return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);
        }

        return Ok({
            record: {
                name: request.name,
                envelopeKey,
                albumKey,
                shortUrl: linked.shortUrl,
                albumUrl: linked.canonicalUrl,
                authKey: linked.authKey,
                shareUrl: createdUrl,
                createdAt: (options.now ?? Date.now)()
            },
            manifest
        });
    });
}

function mediaKeys(request: ShareCreateRequest): string[] {
    return request.files.flatMap((file) => file.chunks.map((chunk) => chunk.mediaKey));
}

function existingShareError(
    request: ShareCreateRequest,
    files: ShareManifestFile[]
): ServerError | null {
    if (request.existing === undefined) return null;

    const decoded = decodeShareUrl(request.existing.shareUrl);
    const manifest = decoded.match({ Ok: (value) => value, Err: () => null });
    if (manifest === null) return SERVER_ERRORS.SHARE_MANIFEST_INVALID;

    if (manifest.album !== request.existing.albumUrl) return SERVER_ERRORS.SHARE_MANIFEST_INVALID;
    if (JSON.stringify(manifest.files) !== JSON.stringify(files))
        return SERVER_ERRORS.SHARE_MANIFEST_INVALID;

    return null;
}

function recoveryError(
    envelopeKey: string,
    albumKey: string
): {
    code: 'SHARE_LINK_UNCERTAIN';
    message: string;
    recovery: ShareRecovery;
} {
    return {
        code: 'SHARE_LINK_UNCERTAIN',
        message: 'The share link may still be public. Remove this share album manually.',
        recovery: { envelopeKey, albumKey }
    };
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

    if (createdAlbum) {
        const album = await removeShareAlbum(request.email, request.token, albumKey, fetcher);
        const albumError = album.match({ Ok: () => null, Err: (error) => error });
        if (albumError !== null && !alreadyGone(albumError)) clean = false;
    }

    return clean;
}
