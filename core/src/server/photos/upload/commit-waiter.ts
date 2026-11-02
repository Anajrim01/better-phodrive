import { Err, type Result } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import type { CommitItem } from './transfer';

export const COMMIT_ABORTED = {
    code: 'REQUEST_FAILED',
    message: 'Commit canceled'
} as const;

export type CommitWaiter = {
    item: CommitItem;
    token: string;
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    signal?: AbortSignal;
    settled: boolean;
    onAbort?: () => void;
    batch?: CommitBatch;
    resolve: (result: Result<string, ServerError>) => void;
};

export type CommitBatch = {
    key: string;
    email: string;
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    waiters: CommitWaiter[];
    inFlight?: CommitWaiter[];
    abort: AbortController;
    timer: ReturnType<typeof setTimeout>;
};

export function makeWaiter(
    item: CommitItem,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher,
    signal: AbortSignal | undefined,
    resolve: (result: Result<string, ServerError>) => void,
    onAbort: (waiter: CommitWaiter) => void
): CommitWaiter {
    const waiter: CommitWaiter = {
        item,
        token: item.transfer.scotty.toString('hex'),
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

export function settleWaiter(waiter: CommitWaiter, result: Result<string, ServerError>): void {
    if (waiter.settled) return;

    waiter.settled = true;
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    waiter.resolve(result);
}

export function settleAll(waiters: CommitWaiter[], result: Result<string, ServerError>): void {
    for (const waiter of waiters) settleWaiter(waiter, result);
}

export function abortWaiter(waiter: CommitWaiter): void {
    settleWaiter(waiter, Err(COMMIT_ABORTED));
}

export function activeWaiters(batch: CommitBatch): CommitWaiter[] {
    return batch.waiters.filter((waiter) => !waiter.settled);
}
