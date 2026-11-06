import { createHash, randomBytes } from 'node:crypto';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import { UploadStatus } from '@madkarmaa/phodrive-core/models';
import { chunkFileName, fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { resolveShortUrl } from '@madkarmaa/phodrive-core/server/photos/shares/google-public';
import {
    createShareAlbum,
    createShareEnvelope,
    enableShareLink,
    type OwnerRpc
} from '@madkarmaa/phodrive-core/server/photos/shares/google-rpc';
import { uploadBmpStream } from '@madkarmaa/phodrive-core/server/photos/upload';
import type { UploadBmpSource } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { accountHash, createLedgerFile, type Ledger, type LedgerFixture } from './ledger.ts';
import {
    asyncOk,
    authenticate,
    inOrder,
    mutationStep,
    persist,
    type OwnerSession,
    type SpikeContext,
    type SpikeError
} from './steps.ts';

const FIXTURE_COUNT = 3;
// Random bytes keep every fixture's SHA-1 unique, so it cannot match existing account media.
const FIXTURE_PAYLOAD_BYTES = 1024;
const LIVE_POLL_ATTEMPTS = 30;
const LIVE_POLL_DELAY_MS = 1_000;

type Fixture = { entry: LedgerFixture; bytes: Uint8Array<ArrayBuffer> };

function createFixture(index: number): Result<Fixture, ServerError> {
    const payload = randomBytes(FIXTURE_PAYLOAD_BYTES);
    const fileHash = createHash('sha256').update(payload).digest('hex');
    const fileName = `spike-${index}.bin`;

    return encodeSplitPrefix({
        fileHash,
        fileId: fileIdentity(fileName, fileHash),
        chunkIndex: 0,
        flags: 1,
        payloadSize: payload.length,
        fileName
    }).map(({ prefix, totalSize }): Fixture => {
        const bytes = new Uint8Array(totalSize);
        bytes.set(prefix);
        bytes.set(payload, prefix.length);

        return {
            bytes,
            entry: {
                name: chunkFileName(fileName, fileHash, 0, 1),
                sha1: createHash('sha1').update(bytes).digest('hex'),
                size: totalSize,
                upload: 'none',
                trash: 'none',
                remove: 'none',
                presence: 'unknown'
            }
        };
    });
}

function createFixtures(): Result<Fixture[], ServerError> {
    const fixtures: Fixture[] = [];

    for (let index = 0; index < FIXTURE_COUNT; index++) {
        const fixture = createFixture(index).inspect((created) => fixtures.push(created));
        if (fixture.isErr()) return fixture;
    }

    return Ok(fixtures);
}

/** Holds the fixtures' own entries, so every state change on one is what gets saved. */
function initialLedger(email: string, fixtures: readonly Fixture[]): Ledger {
    return {
        accountHash: accountHash(email),
        fixtures: fixtures.map(({ entry }) => entry),
        album: {
            title: `phodrive-spike-${randomBytes(8).toString('hex')}`,
            create: 'none',
            remove: 'none'
        },
        envelope: { create: 'none', remove: 'none' },
        link: { enable: 'none', disable: 'none' },
        directUrls: []
    };
}

function fixtureSource({ bytes, entry }: Fixture): UploadBmpSource {
    const verified = Ok(undefined).andThenAsync<void, ServerError>(async () => Ok(undefined));

    return {
        body: new Blob([bytes]).stream(),
        length: bytes.length,
        sha1: entry.sha1,
        verified,
        drain: () => verified
    };
}

function uploadFixture(owner: OwnerSession, fixture: Fixture): AsyncResult<void, SpikeError> {
    const { entry } = fixture;
    const { email, token } = owner.account;

    return mutationStep(owner, {
        stage: 'upload',
        hash: entry.sha1,
        gone: 'rejected',
        set: (step) => {
            entry.upload = step;
        },
        call: () =>
            uploadBmpStream(
                email,
                token,
                entry.name,
                fixtureSource(fixture),
                owner.fetcher,
                undefined,
                owner.scope
            ),
        apply: ({ status, mediaKey }) => {
            if (status === UploadStatus.AlreadyExists) entry.upload = 'preexisting';
            else entry.mediaKey = mediaKey;
        }
    }).andThen(() =>
        entry.upload === 'preexisting' ? Err({ code: 'FIXTURE_PREEXISTS' } as const) : Ok(undefined)
    );
}

function createAlbumStep(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const { album, fixtures } = owner.ledger;
    const mediaKeys = fixtures.flatMap(({ mediaKey }) => mediaKey ?? []);

    return mutationStep(owner, {
        stage: 'album-create',
        gone: 'rejected',
        set: (step) => {
            album.create = step;
        },
        call: () => createShareAlbum(rpc, album.title, mediaKeys),
        apply: (key) => {
            album.key = key;
        }
    });
}

function createEnvelopeStep(
    owner: OwnerSession,
    rpc: OwnerRpc,
    albumKey: string
): AsyncResult<void, SpikeError> {
    const { album, envelope, link } = owner.ledger;

    return mutationStep(owner, {
        stage: 'envelope-create',
        gone: 'rejected',
        set: (step) => {
            envelope.create = step;
        },
        call: () => createShareEnvelope(rpc, albumKey, album.title),
        apply: ({ envelopeKey, pendingShortUrl }) => {
            envelope.key = envelopeKey;
            if (pendingShortUrl) link.shortUrl = pendingShortUrl;
        }
    });
}

function enableLinkStep(
    owner: OwnerSession,
    rpc: OwnerRpc,
    envelopeKey: string
): AsyncResult<void, SpikeError> {
    const { link } = owner.ledger;

    return mutationStep(owner, {
        stage: 'link-enable',
        gone: 'rejected',
        set: (step) => {
            link.enable = step;
        },
        call: () => enableShareLink(rpc, envelopeKey),
        apply: ({ shortUrl, authKey }) => {
            link.shortUrl = shortUrl;
            link.authKey = authKey;
        }
    });
}

function waitForLiveLink(
    owner: OwnerSession,
    shortUrl: string,
    attempt = 1
): AsyncResult<void, SpikeError> {
    return resolveShortUrl(shortUrl, owner.fetcher)
        .map((resolved) => resolved.canonicalUrl)
        .orElse(() => Ok(null))
        .andThenAsync(async (canonicalUrl) => {
            if (canonicalUrl !== null) {
                owner.ledger.link.canonicalUrl = canonicalUrl;
                owner.report({ stage: 'link-live', status: 'live', count: attempt });

                return persist(owner);
            }

            if (attempt >= LIVE_POLL_ATTEMPTS) {
                owner.report({ stage: 'link-live', status: 'not-live', count: attempt });

                return Err({ code: 'LINK_NOT_LIVE' } as const);
            }

            await owner.sleep(LIVE_POLL_DELAY_MS);

            return waitForLiveLink(owner, shortUrl, attempt + 1);
        });
}

function shareSteps(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const { album, envelope, link } = owner.ledger;

    return createAlbumStep(owner, rpc)
        .andThenAsync(() => (album.key ? createEnvelopeStep(owner, rpc, album.key) : asyncOk()))
        .andThenAsync(() => (envelope.key ? enableLinkStep(owner, rpc, envelope.key) : asyncOk()))
        .andThenAsync(() => (link.shortUrl ? waitForLiveLink(owner, link.shortUrl) : asyncOk()));
}

export function runCreate(
    context: SpikeContext,
    path: string,
    account: OwnerSession['account'],
    scope: OwnerSession['scope']
): AsyncResult<void, SpikeError> {
    return createFixtures().andThenAsync((fixtures) => {
        const ledger = initialLedger(account.email, fixtures);
        const owner: OwnerSession = { ...context, path, ledger, account, scope };

        return createLedgerFile(path, ledger)
            .inspect(() =>
                context.report({ stage: 'ledger', status: 'created', count: fixtures.length })
            )
            .andThenAsync(() => inOrder(fixtures, (fixture) => uploadFixture(owner, fixture)))
            .andThenAsync(() => authenticate(owner))
            .andThenAsync((rpc) => shareSteps(owner, rpc));
    });
}
