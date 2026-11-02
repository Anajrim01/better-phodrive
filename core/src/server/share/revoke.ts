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
import {
    isStoppedProbe,
    probeShortUrl,
    probeStopped,
    readFirstDirectUrl,
    type PublicProbe
} from './public';
import { LINK_STATE_DISABLED } from './requests';
import { revokeRecoveryError } from './recovery';

const VERIFY_ATTEMPTS = 5;
const VERIFY_DELAY_MS = 500;

export type ShareRevokeOptions = {
    sleep?: (milliseconds: number) => Promise<void>;
    verifyAttempts?: number;
    verifyDelayMs?: number;
};

type Verification = {
    shortUrl: PublicProbe;
    albumUrl: PublicProbe;
    directUrl: PublicProbe;
};

type VerificationRequirements = {
    shortUrl: boolean;
    albumUrl: boolean;
    directUrl: boolean;
};

const UNKNOWN_PROBE: PublicProbe = { status: null, location: null };

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

    return Ok(undefined).andThenAsync<ShareRevokeResponse, ServerError>(async () => {
        const request = parsed.data;
        const direct = await readFirstDirectUrl(request.shortUrl, fetcher);
        const directReadError = direct.isErr();
        const directUrl = direct.match({ Ok: (value) => value, Err: () => undefined });

        const disabled = await updateLinkState(
            request.email,
            request.token,
            request.envelopeKey,
            LINK_STATE_DISABLED,
            fetcher
        );
        const disableError = disabled.match({ Ok: () => null, Err: (error) => error });
        const disableOk = disableError === null || alreadyGone(disableError);

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
        if (!disableOk || directReadError)
            return Err(revokeRecoveryError(request.envelopeKey, request.albumKey));
        if (
            !isVerified(verification, {
                shortUrl: true,
                albumUrl: true,
                directUrl: directUrl !== undefined
            })
        )
            return Err(revokeRecoveryError(request.envelopeKey, request.albumKey));

        return Ok({
            revoked: true as const,
            shortUrlStatus: verification.shortUrl.status,
            albumUrlStatus: verification.albumUrl.status,
            directUrlStatus: verification.directUrl.status,
            envelopeDeleted: envelope.match({
                Ok: () => true,
                Err: (error) => alreadyGone(error)
            }),
            albumRemoved: album.match({ Ok: () => true, Err: (error) => alreadyGone(error) })
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
        shortUrl: UNKNOWN_PROBE,
        albumUrl: UNKNOWN_PROBE,
        directUrl: UNKNOWN_PROBE
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
    const short = await probeShortUrl(request.shortUrl, fetcher);
    const album = await probeStopped(request.albumUrl, fetcher);
    const direct = directUrl === undefined ? null : await probeStopped(directUrl, fetcher);

    return {
        shortUrl: short.match({ Ok: (value) => value, Err: () => UNKNOWN_PROBE }),
        albumUrl: album.match({ Ok: (value) => value, Err: () => UNKNOWN_PROBE }),
        directUrl:
            direct === null
                ? UNKNOWN_PROBE
                : direct.match({ Ok: (value) => value, Err: () => UNKNOWN_PROBE })
    };
}

function isLive(verification: Verification): boolean {
    return (
        verification.shortUrl.status === 200 ||
        verification.albumUrl.status === 200 ||
        verification.directUrl.status === 200
    );
}

function isVerified(verification: Verification, required: VerificationRequirements): boolean {
    if (required.shortUrl && !isStoppedProbe(verification.shortUrl)) return false;
    if (required.albumUrl && !isStoppedProbe(verification.albumUrl)) return false;
    if (required.directUrl && !isStoppedProbe(verification.directUrl)) return false;

    return true;
}
