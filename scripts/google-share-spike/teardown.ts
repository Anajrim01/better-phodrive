import { parseAlbumUrl } from '@madkarmaa/phodrive-core/server/photos/shares/google-listing';
import {
    classifyPublicProbe,
    probePublicUrl,
    type PublicState
} from '@madkarmaa/phodrive-core/server/photos/shares/google-public';
import { readPublicListing } from '@madkarmaa/phodrive-core/server/photos/shares/google-public-listing';
import {
    deleteShareEnvelope,
    disableShareLink,
    removeShareAlbum,
    type OwnerRpc
} from '@madkarmaa/phodrive-core/server/photos/shares/google-rpc';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { linkMayBeOn, shareResidue } from './ledger.ts';
import { readAlbumListing } from './probe.ts';
import {
    asyncOk,
    authenticate,
    failureStatus,
    mutationStep,
    persist,
    type OwnerSession,
    type SpikeError,
    type SpikeSession
} from './steps.ts';

const VERIFY_ATTEMPTS = 10;
const VERIFY_DELAY_MS = 3_000;
const SINGLE_BYTE_RANGE = { range: 'bytes=0-0' };

type Observation = { stage: string; state: PublicState; host: string };

/** Teardown continues after a failure: it is already recorded and other refs stay independent. */
export function tolerate(step: AsyncResult<void, SpikeError>): AsyncResult<void, SpikeError> {
    return step.orElse((error) =>
        error.code === 'LEDGER_WRITE_FAILED' ? Err(error) : Ok(undefined)
    );
}

function observeAlbum(session: SpikeSession, url: string): Promise<PublicState> {
    return probePublicUrl(url, session.fetcher)
        .andThenAsync(async (probe) => {
            if (probe.status !== 200) return Ok(classifyPublicProbe(probe));

            // A 200 page alone may be a soft error, so only a readable listing counts as live.
            return parseAlbumUrl(url)
                .andThenAsync((album) => readPublicListing(album, session.fetcher))
                .match<PublicState>({ Ok: () => 'live', Err: () => 'unknown' })
                .then((state) => Ok(state));
        })
        .match<PublicState>({ Ok: (state) => state, Err: () => 'unknown' });
}

function observeUrl(
    session: SpikeSession,
    url: string,
    headers?: Record<string, string>
): Promise<PublicState> {
    return probePublicUrl(url, session.fetcher, headers).match<PublicState>({
        Ok: classifyPublicProbe,
        Err: () => 'unknown'
    });
}

async function observePublicUrls(session: SpikeSession, stage: string): Promise<Observation[]> {
    const { link, directUrls } = session.ledger;
    const observations: Observation[] = [];

    if (link.shortUrl)
        observations.push({
            stage: `${stage}-short`,
            state: await observeUrl(session, link.shortUrl),
            host: new URL(link.shortUrl).hostname
        });
    if (link.canonicalUrl)
        observations.push({
            stage: `${stage}-album`,
            state: await observeAlbum(session, link.canonicalUrl),
            host: new URL(link.canonicalUrl).hostname
        });

    for (const url of directUrls)
        observations.push({
            stage: `${stage}-direct`,
            state: await observeUrl(session, url, SINGLE_BYTE_RANGE),
            host: new URL(url).hostname
        });

    return observations;
}

export async function verifyStopped(session: SpikeSession, stage: string): Promise<number> {
    let observations: Observation[] = [];
    let attempt = 0;

    while (attempt < VERIFY_ATTEMPTS) {
        attempt += 1;
        observations = await observePublicUrls(session, stage);
        if (observations.every(({ state }) => state === 'stopped')) break;
        if (attempt < VERIFY_ATTEMPTS) await session.sleep(VERIFY_DELAY_MS);
    }

    for (const { stage: name, state, host } of observations)
        session.report({ stage: name, status: state, count: attempt, host });

    return observations.filter(({ state }) => state !== 'stopped').length;
}

/** Direct media URLs have to be known before revocation can hide them from the listing. */
function captureDirectUrls(session: SpikeSession): AsyncResult<void, SpikeError> {
    const { ledger } = session;
    if (ledger.directUrls.length || !ledger.link.canonicalUrl || ledger.link.disable !== 'none')
        return asyncOk();

    return tolerate(
        readAlbumListing(session)
            .inspectErr((error) =>
                session.report({ stage: 'capture-direct', status: failureStatus(error) })
            )
            .andThenAsync(async (listing) => {
                ledger.directUrls = listing.items.map((item) => item.downloadUrl);

                return persist(session);
            })
    );
}

function disableStep(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const { ledger } = owner;
    const { envelope, link } = ledger;
    const key = envelope.key;
    if (!key || link.disable !== 'none' || !linkMayBeOn(ledger)) return asyncOk();

    return mutationStep(owner, {
        stage: 'link-disable',
        gone: 'ok',
        set: (step) => {
            link.disable = step;
        },
        call: () => disableShareLink(rpc, key),
        apply: () => undefined
    });
}

function deleteEnvelopeStep(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const { envelope } = owner.ledger;
    const key = envelope.key;
    if (!key || envelope.remove !== 'none') return asyncOk();

    return mutationStep(owner, {
        stage: 'envelope-delete',
        gone: 'ok',
        set: (step) => {
            envelope.remove = step;
        },
        call: () => deleteShareEnvelope(rpc, key),
        apply: () => undefined
    });
}

function removeAlbumStep(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const { album } = owner.ledger;
    const key = album.key;
    if (!key || album.remove !== 'none') return asyncOk();

    return mutationStep(owner, {
        stage: 'album-remove',
        gone: 'ok',
        set: (step) => {
            album.remove = step;
        },
        call: () => removeShareAlbum(rpc, key),
        apply: () => undefined
    });
}

// Observes after each step, to show which one actually stops public access.
export function revokeShare(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<number, SpikeError> {
    return captureDirectUrls(owner)
        .andThenAsync(() => tolerate(disableStep(owner, rpc)))
        .mapAsync(() => verifyStopped(owner, 'after-disable'))
        .andThenAsync(() => tolerate(deleteEnvelopeStep(owner, rpc)))
        .andThenAsync(() => tolerate(removeAlbumStep(owner, rpc)))
        .mapAsync(() => verifyStopped(owner, 'after-remove'))
        .map((live) => {
            const residue = shareResidue(owner.ledger);
            owner.report({
                stage: 'share-residue',
                status: residue ? 'unresolved' : 'clear',
                count: residue
            });

            return live + residue;
        });
}

export function runRevoke(owner: OwnerSession): AsyncResult<number, SpikeError> {
    return authenticate(owner).andThenAsync((rpc) => revokeShare(owner, rpc));
}
