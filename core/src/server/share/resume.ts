import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Fetcher } from '../fetcher';
import type { ShareCreateRequest, ShareCreateResponse } from '../../share-models';
import { enableShareLink, updateLinkState } from './link';
import { buildShareUrl, decodeShareUrl } from './manifest';
import { isStoppedProbe, probeShortUrl, probeStopped, type PollOptions } from './public';
import { LINK_STATE_DISABLED } from './requests';
import { alreadyGone } from './envelope';
import { revokeRecoveryError } from './recovery';

export type ResumeOptions = {
    poll: PollOptions;
    retryDelayMs: number;
    now: () => number;
};

export async function resumeShare(
    request: ShareCreateRequest,
    fetcher: Fetcher,
    options: ResumeOptions
): Promise<AsyncResult<ShareCreateResponse, ServerError>> {
    const existing = request.existing;
    if (existing === undefined) return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);

    const decoded = decodeShareUrl(existing.shareUrl);
    const manifest = decoded.match({ Ok: (value) => value, Err: () => null });
    if (manifest === null || manifest.album !== existing.albumUrl)
        return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);

    const link = await enableShareLink(
        request.email,
        request.token,
        existing.envelopeKey,
        undefined,
        existing,
        fetcher,
        { poll: options.poll, retryDelayMs: options.retryDelayMs }
    );
    const linked = link.match({ Ok: (value) => value, Err: () => null });
    if (linked === null) {
        const clean = await stopExistingShare(request, existing, fetcher);
        if (!clean) return Err(revokeRecoveryError(existing.envelopeKey, existing.albumKey));

        const linkError = link.match({ Ok: () => null, Err: (error) => error });
        if (linkError !== null) return Err(linkError);

        return Err(SERVER_ERRORS.SHARE_LINK_UNCERTAIN);
    }

    const nextManifest = { v: 1 as const, album: linked.canonicalUrl, files: manifest.files };
    const nextShareUrl = buildShareUrl(nextManifest);
    const nextUrl = nextShareUrl.match({ Ok: (value) => value, Err: () => '' });
    if (nextUrl === '') {
        const clean = await stopExistingShare(request, existing, fetcher);
        if (!clean) return Err(revokeRecoveryError(existing.envelopeKey, existing.albumKey));

        return Err(SERVER_ERRORS.SHARE_MANIFEST_INVALID);
    }

    return Ok({
        record: {
            name: request.name,
            envelopeKey: existing.envelopeKey,
            albumKey: existing.albumKey,
            shortUrl: linked.shortUrl,
            albumUrl: linked.canonicalUrl,
            authKey: linked.authKey,
            shareUrl: nextUrl,
            createdAt: existing.createdAt
        },
        manifest: nextManifest
    });
}

async function stopExistingShare(
    request: ShareCreateRequest,
    existing: NonNullable<ShareCreateRequest['existing']>,
    fetcher: Fetcher
): Promise<boolean> {
    const disabled = await updateLinkState(
        request.email,
        request.token,
        existing.envelopeKey,
        LINK_STATE_DISABLED,
        fetcher
    );
    const disableError = disabled.match({ Ok: () => null, Err: (error) => error });
    if (disableError !== null && !alreadyGone(disableError)) return false;

    if (existing.shortUrl !== undefined) {
        const short = await probeShortUrl(existing.shortUrl, fetcher);
        const stopped = short.match({ Ok: (value) => isStoppedProbe(value), Err: () => false });
        if (!stopped) return false;
    }

    const album = await probeStopped(existing.albumUrl, fetcher);
    const albumStopped = album.match({ Ok: (value) => isStoppedProbe(value), Err: () => false });

    return albumStopped;
}
