import { Err, type Result } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { hashLookup } from './lookup';

export const HASH_LOOKUP_ABORTED = {
    code: 'REQUEST_FAILED',
    message: 'Hash lookup timed out'
} as const;

export type LookupWaiter = {
    sha1: Buffer;
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    signal?: AbortSignal;
    settled: boolean;
    onAbort?: () => void;
    batch?: LookupBatch;
    resolve: (result: Result<string | null, ServerError>) => void;
};

export type LookupBatch = {
    key: string;
    email: string;
    waiters: LookupWaiter[];
    inFlight?: LookupWaiter[];
    abort: AbortController;
    timer: ReturnType<typeof setTimeout>;
};

export function makeWaiter(
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    signal: AbortSignal | undefined,
    resolve: (result: Result<string | null, ServerError>) => void,
    onAbort: (waiter: LookupWaiter) => void
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
        waiter.onAbort = () => onAbort(waiter);
        signal.addEventListener('abort', waiter.onAbort, { once: true });
    }

    return waiter;
}

export function settleWaiter(
    waiter: LookupWaiter,
    result: Result<string | null, ServerError>
): void {
    if (waiter.settled) return;

    waiter.settled = true;
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(result);
}

export async function lookupWaiterOrAbort(
    email: string,
    waiter: LookupWaiter
): Promise<Result<string | null, ServerError> | null> {
    const signal = waiter.signal;
    if (!signal) return hashLookup(email, waiter.sha1, waiter.rpcHeaders, waiter.fetcher);
    if (signal.aborted) return null;

    const abort = new AbortController();
    const requestFetcher: Fetcher = (url, init) =>
        waiter.fetcher(url, { ...init, signal: abort.signal });
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<null>((resolve) => {
        onAbort = () => {
            abort.abort();
            resolve(null);
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
    const request = Promise.resolve(
        hashLookup(email, waiter.sha1, waiter.rpcHeaders, requestFetcher)
    );
    void request.catch(() => undefined);

    try {
        return await Promise.race([request, aborted]);
    } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
}

export function abortLookup(waiter: LookupWaiter): void {
    settleWaiter(waiter, Err(HASH_LOOKUP_ABORTED));
}
