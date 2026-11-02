import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { photosFetch, type Fetcher } from '../fetcher';
import { removeShareAlbum } from '../photos/albums';
import { alreadyGone, deleteEnvelope } from './envelope';
import { updateLinkState } from './link';
import {
    ShareRevokeRequestSchema,
    type ShareRevokeRequest,
    type ShareRevokeResponse
} from '../../share-models';
import { probeShortUrl, probeStopped, readFirstDirectUrl } from './public';
import { LINK_STATE_DISABLED } from './requests';

const VERIFY_ATTEMPTS = 5;
const VERIFY_DELAY_MS = 500;

export type ShareRevokeOptions = {
    sleep?: (milliseconds: number) => Promise<void>;
    verifyAttempts?: number;
    verifyDelayMs?: number;
};

type Verification = {
    shortUrlStatus: number | null;
    albumUrlStatus: number | null;
    directUrlStatus: number | null;
};

export function revokeShare(
    input: ShareRevokeRequest,
    fetcher: Fetcher = photosFetch,
    options: ShareRevokeOptions = {}
): AsyncResult<ShareRevokeResponse, ServerError> {
    const parsed = ShareRevokeRequestSchema.safeParse(input);
    if (!parsed.success)
        return Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Invalid share request' } as const)
        );

    return Ok(undefined).andThenAsync(async () => {
        const request = parsed.data;
        const directUrl =
            request.shortUrl === undefined
                ? undefined
                : (await readFirstDirectUrl(request.shortUrl, fetcher)).unwrapOr(undefined);

        await updateLinkState(
            request.email,
            request.token,
            request.envelopeKey,
            LINK_STATE_DISABLED,
            fetcher
        );

        const envelope = await deleteEnvelope(
            request.email,
            request.token,
            request.envelopeKey,
            fetcher
        );
        const album = await removeShareAlbum(
            request.email,
            request.token,
            request.albumKey,
            fetcher
        );

        const verification = await verifyStopped(request, directUrl, fetcher, options);
        if (isLive(verification)) return Err(SERVER_ERRORS.SHARE_LINK_STILL_LIVE);

        return Ok({
            revoked: true as const,
            ...verification,
            envelopeDeleted: envelope.isOk() || alreadyGone(envelope.unwrapErr()),
            albumRemoved: album.isOk() || alreadyGone(album.unwrapErr())
        });
    });
}

async function verifyStopped(
    request: ShareRevokeRequest,
    directUrl: string | undefined,
    fetcher: Fetcher,
    options: ShareRevokeOptions
): Promise<Verification> {
    const sleep =
        options.sleep ??
        ((milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds)));
    const attempts = options.verifyAttempts ?? VERIFY_ATTEMPTS;
    let verification: Verification = {
        shortUrlStatus: null,
        albumUrlStatus: null,
        directUrlStatus: null
    };

    for (let attempt = 0; attempt < attempts; attempt++) {
        verification = await readVerification(request, directUrl, fetcher);
        if (!isLive(verification)) return verification;

        if (attempt + 1 < attempts) await sleep(options.verifyDelayMs ?? VERIFY_DELAY_MS);
    }

    return verification;
}

async function readVerification(
    request: ShareRevokeRequest,
    directUrl: string | undefined,
    fetcher: Fetcher
): Promise<Verification> {
    const short =
        request.shortUrl === undefined ? null : await probeShortUrl(request.shortUrl, fetcher);
    const album =
        request.albumUrl === undefined ? null : await probeStopped(request.albumUrl, fetcher);
    const direct = directUrl === undefined ? null : await probeStopped(directUrl, fetcher);

    return {
        shortUrlStatus: short === null ? null : short.unwrapOr({ status: null }).status,
        albumUrlStatus: album?.unwrapOr(null) ?? null,
        directUrlStatus: direct?.unwrapOr(null) ?? null
    };
}

function isLive(verification: Verification): boolean {
    return (
        verification.shortUrlStatus === 200 ||
        verification.albumUrlStatus === 200 ||
        verification.directUrlStatus === 200
    );
}
