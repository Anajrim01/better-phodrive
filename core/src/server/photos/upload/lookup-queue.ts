import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { Fetcher } from '../../fetcher';
import { hashLookup, hashLookupMany, type HashLookupResults } from './lookup';

const HASH_LOOKUP_BATCH_SIZE = 20;
const HASH_LOOKUP_WINDOW_MS = 8;

type LookupWaiter = {
    sha1: Buffer;
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    resolve: (result: Result<string | null, ServerError>) => void;
};

type LookupBatch = {
    email: string;
    waiters: LookupWaiter[];
    timer: ReturnType<typeof setTimeout>;
};

const lookupBatches = new Map<string, LookupBatch>();

export function lookupHash(
    email: string,
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string | null, ServerError> {
    return Ok(undefined).andThenAsync(
        () =>
            new Promise<Result<string | null, ServerError>>((resolve) => {
                const current = lookupBatches.get(email);

                if (current) {
                    current.waiters.push({ sha1, rpcHeaders, fetcher, resolve });
                    if (current.waiters.length >= HASH_LOOKUP_BATCH_SIZE) {
                        clearTimeout(current.timer);
                        void flushLookupBatch(current);
                    }

                    return;
                }

                const batch: LookupBatch = {
                    email,
                    waiters: [{ sha1, rpcHeaders, fetcher, resolve }],
                    timer: setTimeout(() => void flushLookupBatch(batch), HASH_LOOKUP_WINDOW_MS)
                };
                batch.timer.unref();
                lookupBatches.set(email, batch);
            })
    );
}

async function flushLookupBatch(batch: LookupBatch): Promise<void> {
    if (lookupBatches.get(batch.email) === batch) lookupBatches.delete(batch.email);

    clearTimeout(batch.timer);

    const waiters = batch.waiters.splice(0);
    if (waiters.length === 0) return;

    const unique = new Map<string, Buffer>();
    const representatives = new Map<string, LookupWaiter>();
    for (const waiter of waiters) {
        const hex = waiter.sha1.toString('hex');
        unique.set(hex, waiter.sha1);
        if (!representatives.has(hex)) representatives.set(hex, waiter);
    }

    const first = waiters[0];
    const batchResult = await hashLookupMany(
        batch.email,
        [...unique.values()],
        first.rpcHeaders,
        first.fetcher
    );
    const outcome = batchResult.match<{
        value: HashLookupResults | null;
        error: ServerError | null;
    }>({
        Ok: (value) => ({ value, error: null }),
        Err: (error) => ({ value: null, error })
    });

    if (outcome.value) {
        for (const waiter of waiters) {
            waiter.resolve(Ok(outcome.value.get(waiter.sha1.toString('hex')) ?? null));
        }

        return;
    }

    const singleResults = new Map<string, Result<string | null, ServerError>>();
    await Promise.all(
        [...representatives].map(async ([hex, waiter]) => {
            const result = await hashLookup(
                batch.email,
                waiter.sha1,
                waiter.rpcHeaders,
                waiter.fetcher
            );
            singleResults.set(hex, result);
        })
    );

    for (const waiter of waiters) {
        const result = singleResults.get(waiter.sha1.toString('hex'));
        waiter.resolve(result ?? Err(outcome.error ?? SERVER_ERRORS.HASH_LOOKUP_MISMATCH));
    }
}
