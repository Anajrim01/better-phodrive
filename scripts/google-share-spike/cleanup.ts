import {
    mutatePhotos,
    type MutationTarget
} from '@madkarmaa/phodrive-core/server/photos/mutations';
import type { OwnerRpc } from '@madkarmaa/phodrive-core/server/photos/shares/google-rpc';
import { hashLookup } from '@madkarmaa/phodrive-core/server/photos/upload/requests';
import type { AsyncResult } from 'results-ts';
import { mediaResidue, shareResidue, type LedgerFixture, type Step } from './ledger.ts';
import {
    authenticate,
    failureStatus,
    inOrder,
    persist,
    type OwnerSession,
    type SpikeError
} from './steps.ts';
import { revokeShare, tolerate, verifyStopped } from './teardown.ts';

type OwnedTarget = MutationTarget & { fixture: LedgerFixture };

function lookupFixture(
    owner: OwnerSession,
    rpc: OwnerRpc,
    fixture: LedgerFixture
): AsyncResult<void, SpikeError> {
    fixture.presence = 'unknown';

    return persist(owner)
        .andThenAsync(() =>
            hashLookup(Buffer.from(fixture.sha1, 'hex'), rpc.rpcHeaders, rpc.fetcher, rpc.scope)
        )
        .andThenAsync(async (mediaKey) => {
            fixture.presence = mediaKey === null ? 'absent' : 'present';
            const ambiguous = fixture.upload === 'pending' || fixture.upload === 'uncertain';
            if (ambiguous && mediaKey !== null) {
                // The SHA-1 covers bytes this run generated, so a match is this run's upload.
                fixture.mediaKey = mediaKey;
                fixture.upload = 'ok';
            }
            if (ambiguous && mediaKey === null) fixture.upload = 'rejected';
            if (
                mediaKey === null &&
                (fixture.remove === 'pending' || fixture.remove === 'uncertain')
            )
                fixture.remove = 'ok';

            owner.report({
                stage: 'media-lookup',
                status: mediaKey === null ? 'absent' : 'present',
                hash: fixture.sha1
            });

            return persist(owner);
        });
}

function ownedTargets(
    owner: OwnerSession,
    done: (fixture: LedgerFixture) => boolean
): OwnedTarget[] {
    return owner.ledger.fixtures.flatMap((fixture) => {
        const { upload, mediaKey, sha1 } = fixture;
        if (upload !== 'ok' || mediaKey === undefined || done(fixture)) return [];

        return [{ mediaKey, sha1, fixture }];
    });
}

/** One batch attempt. Only confirmed items move on; the rest stay uncertain and are not re-sent. */
function mutateOwned(
    owner: OwnerSession,
    rpc: OwnerRpc,
    kind: 'trash' | 'delete',
    targets: readonly OwnedTarget[],
    set: (fixture: LedgerFixture, step: Step) => void
): AsyncResult<void, SpikeError> {
    const stage = `media-${kind}`;
    if (!targets.length) return persist(owner);

    for (const { fixture } of targets) set(fixture, 'pending');

    return persist(owner).andThenAsync(async () => {
        const outcome = await mutatePhotos(kind, owner.account, targets, rpc.scope, rpc.fetcher);
        const applied = outcome.match<readonly OwnedTarget[]>({
            Ok: (value) => value.applied,
            Err: () => []
        });
        const failure = outcome.match<SpikeError | undefined>({
            Ok: (value) => value.failure,
            Err: (error) => error
        });

        for (const { fixture } of targets) set(fixture, 'uncertain');
        for (const { fixture } of applied) set(fixture, 'ok');

        owner.report({
            stage,
            status: failure ? `uncertain:${failureStatus(failure)}` : 'ok',
            count: applied.length
        });

        return persist(owner);
    });
}

function removeMedia(owner: OwnerSession, rpc: OwnerRpc): AsyncResult<void, SpikeError> {
    const removable = () =>
        owner.ledger.fixtures.filter(({ upload }) =>
            ['ok', 'pending', 'uncertain'].includes(upload)
        );

    return inOrder(removable(), (fixture) => tolerate(lookupFixture(owner, rpc, fixture)))
        .andThenAsync(() =>
            mutateOwned(
                owner,
                rpc,
                'trash',
                ownedTargets(owner, ({ trash }) => trash !== 'none'),
                (fixture, step) => {
                    fixture.trash = step;
                }
            )
        )
        .andThenAsync(() =>
            mutateOwned(
                owner,
                rpc,
                'delete',
                ownedTargets(owner, ({ trash, remove }) => trash !== 'ok' || remove !== 'none'),
                (fixture, step) => {
                    fixture.remove = step;
                }
            )
        )
        .andThenAsync(() =>
            inOrder(removable(), (fixture) => tolerate(lookupFixture(owner, rpc, fixture)))
        );
}

export function runCleanup(owner: OwnerSession): AsyncResult<number, SpikeError> {
    return authenticate(owner).andThenAsync((rpc) =>
        revokeShare(owner, rpc)
            .andThenAsync(() => tolerate(removeMedia(owner, rpc)))
            .mapAsync(() => verifyStopped(owner, 'after-cleanup'))
            .map((live) => {
                const media = mediaResidue(owner.ledger);
                owner.report({
                    stage: 'media-residue',
                    status: media ? 'unresolved' : 'clear',
                    count: media
                });

                return live + shareResidue(owner.ledger) + media;
            })
    );
}
