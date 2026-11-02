import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type Result } from 'results-ts';
import { hashLookupManyWithPresence, type HashLookupEntries } from './lookup';
import { commitBmpMany, commitFailure } from './transfer';
import {
    COMMIT_ABORTED,
    settleAll,
    settleWaiter,
    type CommitBatch,
    type CommitWaiter
} from './commit-waiter';

type SingleCommit =
    | { readonly type: 'key'; readonly key: string }
    | { readonly type: 'missing' }
    | { readonly type: 'failure'; readonly error: ServerError };

export async function handleBatchFailure(
    batch: CommitBatch,
    active: CommitWaiter[],
    error: ServerError
): Promise<void> {
    if (error.code === 'THROTTLED') {
        settleAll(active, Err(error));

        return;
    }
    if (shouldFallback(error, active.length)) {
        await fallbackBatch(batch, active);

        return;
    }
    if (isUncertain(error)) {
        await reconcile(batch, active);

        return;
    }

    settleAll(active, Err(commitFailure(error)));
}

export async function settleOutcome(
    batch: CommitBatch,
    active: CommitWaiter[],
    outcome: ReadonlyMap<string, Result<string, ServerError>>
): Promise<void> {
    const uncertain: CommitWaiter[] = [];

    for (const waiter of active) {
        if (waiter.settled) continue;

        const result = outcome.get(waiter.token);
        if (!result) {
            uncertain.push(waiter);

            continue;
        }

        settleWaiter(waiter, result.mapErr(commitFailure));
    }

    await reconcile(batch, uncertain);
}

async function fallbackBatch(batch: CommitBatch, waiters: CommitWaiter[]): Promise<void> {
    await Promise.all(waiters.map((waiter) => fallbackSingle(batch, waiter)));
}

async function fallbackSingle(batch: CommitBatch, waiter: CommitWaiter): Promise<void> {
    if (waiter.settled) return;
    if (waiter.signal?.aborted) {
        settleWaiter(waiter, Err(COMMIT_ABORTED));

        return;
    }

    const result = await commitSingle(batch, waiter);
    if (result.type === 'key') {
        settleWaiter(waiter, Ok(result.key));

        return;
    }
    if (result.type === 'missing' || isUncertain(result.error)) {
        await reconcile(batch, [waiter]);

        return;
    }

    settleWaiter(waiter, Err(commitFailure(result.error)));
}

async function commitSingle(batch: CommitBatch, waiter: CommitWaiter): Promise<SingleCommit> {
    const committed = await commitBmpMany(
        batch.email,
        [waiter.item],
        waiter.rpcHeaders,
        waiter.fetcher
    );

    return committed.match<SingleCommit>({
        Ok: (outcome) => {
            const result = outcome.get(waiter.token);
            if (!result) return { type: 'missing' };

            return result.match<SingleCommit>({
                Ok: (key) => ({ type: 'key', key }),
                Err: (error) => ({ type: 'failure', error })
            });
        },
        Err: (error) => ({ type: 'failure', error })
    });
}

async function reconcile(batch: CommitBatch, waiters: CommitWaiter[]): Promise<void> {
    const active = waiters.filter((waiter) => {
        if (waiter.settled) return false;
        if (!waiter.signal?.aborted) return true;

        settleWaiter(waiter, Err(COMMIT_ABORTED));

        return false;
    });
    if (active.length === 0) return;

    const unique = new Map<string, Buffer>();
    for (const waiter of active) unique.set(waiter.item.sha1.toString('hex'), waiter.item.sha1);

    const lookup = await hashLookupManyWithPresence(
        batch.email,
        [...unique.values()],
        batch.rpcHeaders,
        batch.fetcher
    );
    const entries = lookup.match<HashLookupEntries | null>({
        Ok: (value) => value,
        Err: () => null
    });
    if (!entries) {
        settleAll(active, Err(SERVER_ERRORS.COMMIT_OUTCOME_UNCERTAIN));

        return;
    }

    await Promise.all(
        active.map(async (waiter) => {
            if (waiter.settled) return;

            const hash = waiter.item.sha1.toString('hex');
            if (!entries.present.has(hash)) {
                settleWaiter(waiter, Err(SERVER_ERRORS.COMMIT_OUTCOME_UNCERTAIN));

                return;
            }

            const key = entries.results.get(hash);
            if (key) {
                settleWaiter(waiter, Ok(key));

                return;
            }

            await retrySingle(batch, waiter);
        })
    );
}

async function retrySingle(batch: CommitBatch, waiter: CommitWaiter): Promise<void> {
    if (waiter.settled) return;
    if (waiter.signal?.aborted) {
        settleWaiter(waiter, Err(COMMIT_ABORTED));

        return;
    }

    const result = await commitSingle(batch, waiter);
    if (result.type === 'key') {
        settleWaiter(waiter, Ok(result.key));

        return;
    }

    const error = result.type === 'failure' ? result.error : SERVER_ERRORS.COMMIT_TOKEN_MISMATCH;
    settleWaiter(waiter, Err(commitFailure(error)));
}

function shouldFallback(error: ServerError, waiters: number): boolean {
    if (waiters < 2) return false;
    if (error.code !== 'REQUEST_FAILED' || error.status === undefined) return false;

    return error.status === 400 || error.status === 413;
}

function isUncertain(error: ServerError): boolean {
    if (error.code !== 'REQUEST_FAILED') return false;
    if (error.status === undefined) return true;

    return error.status === 408 || error.status === 409;
}
