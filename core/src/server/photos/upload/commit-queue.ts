import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { commitBmpMany, type Transfer } from './transfer';
import { handleBatchFailure, settleOutcome } from './commit-recovery';
import {
    COMMIT_ABORTED,
    abortWaiter,
    activeWaiters,
    makeWaiter,
    settleWaiter,
    type CommitBatch
} from './commit-waiter';

const COMMIT_BATCH_SIZE = 20;
const COMMIT_WINDOW_MS = 8;

const commitBatches = new Map<string, CommitBatch>();

export function commitBmpQueued(
    email: string,
    name: string,
    sha1: Buffer,
    transfer: Transfer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    signal?: AbortSignal
): AsyncResult<string, ServerError> {
    return Ok(undefined).andThenAsync(
        () =>
            new Promise<Result<string, ServerError>>((resolve) => {
                if (signal?.aborted) {
                    resolve(Err(COMMIT_ABORTED));

                    return;
                }

                const item = { name, sha1, transfer };
                const waiter = makeWaiter(item, rpcHeaders, fetcher, signal, resolve, (created) => {
                    abortWaiter(created);
                    abortIdleBatch(created.batch);
                });
                const key = batchKey(email, rpcHeaders);
                const current = commitBatches.get(key);

                if (current) {
                    waiter.batch = current;
                    current.waiters.push(waiter);
                    if (activeWaiters(current).length >= COMMIT_BATCH_SIZE) {
                        clearTimeout(current.timer);
                        void flushBatch(current);
                    }

                    return;
                }

                const batch: CommitBatch = {
                    key,
                    email,
                    rpcHeaders,
                    fetcher,
                    waiters: [],
                    abort: new AbortController(),
                    timer: setTimeout(() => void flushBatch(batch), COMMIT_WINDOW_MS)
                };
                waiter.batch = batch;
                batch.waiters.push(waiter);
                commitBatches.set(key, batch);
            })
    );
}

async function flushBatch(batch: CommitBatch): Promise<void> {
    if (commitBatches.get(batch.key) === batch) commitBatches.delete(batch.key);

    clearTimeout(batch.timer);

    const waiters = batch.waiters.splice(0);
    batch.inFlight = waiters;
    if (waiters.length === 0) return;

    for (const waiter of waiters) {
        if (waiter.signal?.aborted) settleWaiter(waiter, Err(COMMIT_ABORTED));
    }

    const active = waiters.filter((waiter) => !waiter.settled);
    if (active.length === 0) {
        abortIdleBatch(batch);

        return;
    }

    const requestFetcher: Fetcher = (url, init) =>
        batch.fetcher(url, { ...init, signal: batch.abort.signal });
    const committed = await commitBmpMany(
        batch.email,
        active.map((waiter) => waiter.item),
        batch.rpcHeaders,
        requestFetcher
    );

    await committed.match({
        Ok: (outcome) => settleOutcome(batch, active, outcome),
        Err: (error) => handleBatchFailure(batch, active, error)
    });
}

function abortIdleBatch(batch: CommitBatch | undefined): void {
    if (!batch) return;

    const waiters = batch.inFlight ?? batch.waiters;
    if (waiters.some((waiter) => !waiter.settled)) return;

    batch.abort.abort();
    if (commitBatches.get(batch.key) === batch) commitBatches.delete(batch.key);
    clearTimeout(batch.timer);
}

function batchKey(email: string, rpcHeaders: Record<string, string>): string {
    const authorization =
        Object.entries(rpcHeaders).find(([name]) => name.toLowerCase() === 'authorization')?.[1] ??
        '';

    return `${email}
${authorization}`;
}
