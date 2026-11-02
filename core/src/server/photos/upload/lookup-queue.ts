import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { Fetcher } from '../../fetcher';
import { hashLookupMany, type HashLookupResults } from './lookup';
import {
    HASH_LOOKUP_ABORTED,
    abortLookup,
    lookupWaiterOrAbort,
    makeWaiter,
    settleWaiter,
    type LookupBatch,
    type LookupWaiter
} from './lookup-waiter';

const HASH_LOOKUP_BATCH_SIZE = 20;
const HASH_LOOKUP_WINDOW_MS = 8;

type LookupOutcome = { ok: true; value: HashLookupResults } | { ok: false; error: ServerError };

const lookupBatches = new Map<string, LookupBatch>();

export function lookupHash(
    email: string,
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    signal?: AbortSignal
): AsyncResult<string | null, ServerError> {
    return Ok(undefined).andThenAsync(
        () =>
            new Promise<Result<string | null, ServerError>>((resolve) => {
                if (signal?.aborted) {
                    resolve(Err(HASH_LOOKUP_ABORTED));

                    return;
                }

                const waiter = makeWaiter(sha1, rpcHeaders, fetcher, signal, resolve, (created) => {
                    abortLookup(created);
                    abortIdleBatch(created.batch);
                });
                const key = lookupBatchKey(email, rpcHeaders);
                const current = lookupBatches.get(key);

                if (current) {
                    waiter.batch = current;
                    current.waiters.push(waiter);
                    if (current.waiters.length >= HASH_LOOKUP_BATCH_SIZE) {
                        clearTimeout(current.timer);
                        void flushLookupBatch(current);
                    }

                    return;
                }

                const batch: LookupBatch = {
                    key,
                    email,
                    waiters: [],
                    abort: new AbortController(),
                    timer: setTimeout(() => void flushLookupBatch(batch), HASH_LOOKUP_WINDOW_MS)
                };
                waiter.batch = batch;
                batch.waiters.push(waiter);
                lookupBatches.set(key, batch);
            })
    );
}

async function flushLookupBatch(batch: LookupBatch): Promise<void> {
    if (lookupBatches.get(batch.key) === batch) lookupBatches.delete(batch.key);

    clearTimeout(batch.timer);

    const waiters = batch.waiters.splice(0);
    batch.inFlight = waiters;
    if (waiters.length === 0) return;

    const activeWaiters = waiters.filter((waiter) => !waiter.signal?.aborted);
    if (activeWaiters.length === 0) {
        for (const waiter of waiters) settleWaiter(waiter, Err(HASH_LOOKUP_ABORTED));

        return;
    }

    const unique = new Map<string, Buffer>();
    const candidates = new Map<string, LookupWaiter[]>();
    for (const waiter of activeWaiters) {
        const hex = waiter.sha1.toString('hex');
        unique.set(hex, waiter.sha1);

        const existing = candidates.get(hex);
        if (existing) existing.push(waiter);
        else candidates.set(hex, [waiter]);
    }

    const first = activeWaiters[0];
    const requestFetcher: Fetcher = (url, init) =>
        first.fetcher(url, { ...init, signal: batch.abort.signal });
    const batchResult = await hashLookupMany(
        batch.email,
        [...unique.values()],
        first.rpcHeaders,
        requestFetcher
    );
    const outcome = batchResult.match<LookupOutcome>({
        Ok: (value) => ({ ok: true, value }),
        Err: (error) => ({ ok: false, error })
    });

    if (outcome.ok) {
        for (const waiter of waiters) {
            const result = waiter.signal?.aborted
                ? Err(HASH_LOOKUP_ABORTED)
                : Ok(outcome.value.get(waiter.sha1.toString('hex')) ?? null);
            settleWaiter(waiter, result);
        }

        return;
    }

    if (!shouldFallback(outcome.error, activeWaiters.length)) {
        for (const waiter of waiters) {
            settleWaiter(
                waiter,
                waiter.signal?.aborted ? Err(HASH_LOOKUP_ABORTED) : Err(outcome.error)
            );
        }

        return;
    }

    await Promise.all(
        [...candidates].map(async ([, hashWaiters]) => {
            const available = hashWaiters.filter((waiter) => !waiter.signal?.aborted);
            if (available.length === 0) {
                for (const waiter of hashWaiters) settleWaiter(waiter, Err(HASH_LOOKUP_ABORTED));

                return;
            }

            let result: Result<string | null, ServerError> | null = null;
            for (const waiter of available) {
                const attempt = await lookupWaiterOrAbort(batch.email, waiter);
                if (attempt === null) continue;

                result = attempt;
                if (result.isOk() || !waiter.signal?.aborted) break;
            }

            for (const waiter of hashWaiters) {
                settleWaiter(
                    waiter,
                    waiter.signal?.aborted
                        ? Err(HASH_LOOKUP_ABORTED)
                        : (result ?? Err(HASH_LOOKUP_ABORTED))
                );
            }
        })
    );
}

function abortIdleBatch(batch: LookupBatch | undefined): void {
    if (!batch) return;

    const waiters = batch.inFlight ?? batch.waiters;
    if (waiters.some((waiter) => !waiter.settled)) return;

    batch.abort.abort();
    if (lookupBatches.get(batch.key) === batch) lookupBatches.delete(batch.key);
    clearTimeout(batch.timer);
}

function lookupBatchKey(email: string, rpcHeaders: Record<string, string>): string {
    return `${email}
${rpcHeaders.authorization ?? ''}`;
}

function shouldFallback(error: ServerError, callers: number): boolean {
    if (error.code === 'THROTTLED') return false;
    if (error.code !== 'REQUEST_FAILED') return true;
    if (error.status === undefined) return false;
    if (error.status !== 400 && error.status !== 413) return false;

    return callers > 1;
}
