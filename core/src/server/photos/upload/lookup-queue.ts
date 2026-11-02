import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { Fetcher } from '../../fetcher';
import { hashLookup, hashLookupMany, type HashLookupResults } from './lookup';

const HASH_LOOKUP_BATCH_SIZE = 20;
const HASH_LOOKUP_WINDOW_MS = 8;
const HASH_LOOKUP_ABORTED = {
    code: 'REQUEST_FAILED',
    message: 'Hash lookup timed out'
} as const;

type LookupWaiter = {
    sha1: Buffer;
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    signal?: AbortSignal;
    settled: boolean;
    onAbort?: () => void;
    resolve: (result: Result<string | null, ServerError>) => void;
};

type LookupBatch = {
    email: string;
    waiters: LookupWaiter[];
    timer: ReturnType<typeof setTimeout>;
};

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

                const waiter = makeWaiter(sha1, rpcHeaders, fetcher, signal, resolve);
                const current = lookupBatches.get(email);

                if (current) {
                    current.waiters.push(waiter);
                    if (current.waiters.length >= HASH_LOOKUP_BATCH_SIZE) {
                        clearTimeout(current.timer);
                        void flushLookupBatch(current);
                    }

                    return;
                }

                const batch: LookupBatch = {
                    email,
                    waiters: [waiter],
                    timer: setTimeout(() => void flushLookupBatch(batch), HASH_LOOKUP_WINDOW_MS)
                };
                lookupBatches.set(email, batch);
            })
    );
}

async function flushLookupBatch(batch: LookupBatch): Promise<void> {
    if (lookupBatches.get(batch.email) === batch) lookupBatches.delete(batch.email);

    clearTimeout(batch.timer);

    const waiters = batch.waiters.splice(0);
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
    const batchResult = await hashLookupMany(
        batch.email,
        [...unique.values()],
        first.rpcHeaders,
        first.fetcher
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

function makeWaiter(
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    signal: AbortSignal | undefined,
    resolve: (result: Result<string | null, ServerError>) => void
): LookupWaiter {
    const waiter: LookupWaiter = {
        sha1,
        rpcHeaders,
        fetcher,
        signal,
        settled: false,
        resolve
    };

    if (signal) {
        waiter.onAbort = () => settleWaiter(waiter, Err(HASH_LOOKUP_ABORTED));
        signal.addEventListener('abort', waiter.onAbort, { once: true });
    }

    return waiter;
}

function settleWaiter(waiter: LookupWaiter, result: Result<string | null, ServerError>): void {
    if (waiter.settled) return;

    waiter.settled = true;
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(result);
}

async function lookupWaiterOrAbort(
    email: string,
    waiter: LookupWaiter
): Promise<Result<string | null, ServerError> | null> {
    const signal = waiter.signal;
    if (!signal) return lookupWaiter(email, waiter);
    if (signal.aborted) return null;

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
        onAbort = () => resolve(null);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = Promise.resolve(lookupWaiter(email, waiter));
    void request.catch(() => undefined);

    try {
        return await Promise.race([request, aborted]);
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
}

function lookupWaiter(
    email: string,
    waiter: LookupWaiter
): AsyncResult<string | null, ServerError> {
    return hashLookup(email, waiter.sha1, waiter.rpcHeaders, waiter.fetcher);
}

function shouldFallback(error: ServerError, callers: number): boolean {
    if (error.code === 'THROTTLED') return false;
    if (error.code !== 'REQUEST_FAILED') return true;
    if (error.status === undefined) return false;
    if (error.status !== 400 && error.status !== 413) return false;

    return callers > 1;
}
