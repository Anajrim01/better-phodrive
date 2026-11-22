import { INTEGRITY_FAILED } from '@madkarmaa/phodrive-core/browser/chunk-verifier';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareChunkSession, ShareFile } from '@madkarmaa/phodrive-core/models';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { getShareChunk } from '#browser/shares';
import type {
    ShareDownloadOutcome,
    ShareDownloadTarget,
    ShareDownloadWorker
} from './share-download-protocol';
import { createShareDownloadWorker } from './share-download-worker-client';

const RECEIVE_FAILED = {
    code: 'DOWNLOAD_RECEIVE_FAILED',
    message: 'Could not receive the downloaded file.'
} as const satisfies ApplicationError;
const CAPABILITY_EXPIRED = {
    code: 'REQUEST_FAILED',
    message: 'The download link expired. Try again.'
} as const satisfies ApplicationError;
const CANCELLED = {
    code: 'DOWNLOAD_RECEIVE_FAILED',
    message: 'The download was cancelled.'
} as const satisfies ApplicationError;

const RATE_LIMIT_STATUS = 429;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 1;
const MAX_RATE_LIMIT_ATTEMPTS = 5;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

export type ShareDownloadOptions = {
    readonly onProgress?: (completed: number, total: number) => void;
    readonly signal?: AbortSignal;
    readonly target?: ShareDownloadTarget;
};

// The browser requires the save picker during the click's user activation.
export function pickShareDownloadTarget(
    name: string
): AsyncResult<ShareDownloadTarget, ApplicationError> {
    return Ok(undefined).andThenAsync<ShareDownloadTarget, ApplicationError>(async () => {
        const picker = window.showSaveFilePicker;
        if (!picker) return Ok({ kind: 'automatic' } as const);

        try {
            const handle = await picker.call(window, { suggestedName: name });

            return Ok({ kind: 'picker', handle } as const);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError')
                return Ok({ kind: 'cancelled' } as const);

            return Ok({ kind: 'automatic' } as const);
        }
    });
}

function fetchPayload(
    url: string,
    capability: string,
    size: number,
    signal?: AbortSignal
): AsyncResult<Response | null, ApplicationError> {
    return Ok(undefined).andThenAsync<Response | null, ApplicationError>(async () => {
        if (size === 0) return Ok(null);
        if (signal?.aborted) return Err(CANCELLED);

        let response: Response;

        try {
            response = await fetch(url, {
                method: 'GET',
                headers: { authorization: `Bearer ${capability}`, range: `bytes=0-${size - 1}` },
                ...(signal ? { signal } : {})
            });
        } catch {
            return Err(signal?.aborted ? CANCELLED : RECEIVE_FAILED);
        }

        if (
            response.status === 206 &&
            response.headers.get('content-range') === `bytes 0-${size - 1}/${size}`
        )
            return Ok(response);

        await response.body?.cancel().catch(() => {});

        return Err(response.status === 401 ? CAPABILITY_EXPIRED : RECEIVE_FAILED);
    });
}

function readPayload(
    worker: ShareDownloadWorker,
    response: Response,
    size: number,
    signal?: AbortSignal
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync<void, ApplicationError>(async () => {
        const body = response.body;
        if (!body) return Err(RECEIVE_FAILED);

        const reader = body.getReader();
        let received = 0;

        try {
            while (true) {
                const next = await reader.read();
                if (next.done) return received === size ? Ok(undefined) : Err(INTEGRITY_FAILED);

                received += next.value.byteLength;
                if (received > size) return Err(INTEGRITY_FAILED);

                const appended = await worker.append(next.value);
                if (appended.isErr()) return appended;
            }
        } catch {
            return Err(signal?.aborted ? CANCELLED : RECEIVE_FAILED);
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    });
}

function rateLimitDelay(
    error: ApplicationError,
    attempts: number,
    waitedMs: number
): number | null {
    const rateLimited =
        error.code === 'THROTTLED' || ('status' in error && error.status === RATE_LIMIT_STATUS);
    if (!rateLimited || attempts >= MAX_RATE_LIMIT_ATTEMPTS) return null;

    const advertised =
        'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
            ? error.retryAfterSeconds
            : DEFAULT_RATE_LIMIT_WAIT_SECONDS;
    const delay = Math.max(0, advertised) * 1000;

    return waitedMs + delay <= MAX_RATE_LIMIT_WAIT_MS ? delay : null;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(
        () =>
            new Promise((resolve) => {
                if (signal?.aborted) {
                    resolve(Err(CANCELLED));

                    return;
                }

                const onAbort = () => {
                    clearTimeout(timer);
                    resolve(Err(CANCELLED));
                };

                const timer = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort);
                    resolve(Ok(undefined));
                }, delayMs);

                signal?.addEventListener('abort', onAbort, { once: true });
            })
    );
}

function requestChunkSession(
    token: string,
    fileId: string,
    index: number,
    signal?: AbortSignal,
    attempt = 0,
    waitedMs = 0
): AsyncResult<ShareChunkSession, ApplicationError> {
    return getShareChunk(token, fileId, index, signal).orElseAsync(async (failure) => {
        const delay = rateLimitDelay(failure, attempt, waitedMs);
        if (delay === null) return Err(failure);

        const waited = await waitForRetry(delay, signal);
        if (waited.isErr()) return Err(CANCELLED);

        return requestChunkSession(token, fileId, index, signal, attempt + 1, waitedMs + delay);
    });
}

function readChunk(
    worker: ShareDownloadWorker,
    token: string,
    file: ShareFile,
    index: number,
    signal?: AbortSignal
): AsyncResult<void, ApplicationError> {
    return requestChunkSession(token, file.id, index, signal).andThenAsync(async (session) => {
        if (
            session.chunk.index !== index ||
            session.chunk.isLast !== (index === file.chunkCount - 1)
        )
            return Err(INTEGRITY_FAILED);

        return fetchPayload(
            session.url,
            session.capability,
            session.chunk.size,
            signal
        ).andThenAsync(async (body) => {
            if (!body) return Ok(undefined);

            return readPayload(worker, body, session.chunk.size, signal);
        });
    });
}

function readChunks(
    worker: ShareDownloadWorker,
    token: string,
    file: ShareFile,
    options: ShareDownloadOptions,
    index = 0
): AsyncResult<ShareDownloadOutcome, ApplicationError> {
    if (options.signal?.aborted) return worker.abort().andThen(() => Err(CANCELLED));
    if (index === file.chunkCount) return worker.finish();

    return readChunk(worker, token, file, index, options.signal).andThenAsync(async () => {
        options.onProgress?.(index + 1, file.chunkCount);

        return readChunks(worker, token, file, options, index + 1);
    });
}

function run(
    worker: ShareDownloadWorker,
    token: string,
    file: ShareFile,
    options: ShareDownloadOptions
): AsyncResult<ShareDownloadOutcome, ApplicationError> {
    if (options.signal?.aborted) return worker.abort().andThen(() => Err(CANCELLED));

    return worker
        .open(file, options.target ?? { kind: 'automatic' })
        .andThenAsync(() => readChunks(worker, token, file, options))
        .orElseAsync(async (failure) => {
            await worker.abort();

            return Err(failure);
        });
}

let offeredUrl: string | null = null;

// The browser reads this File from OPFS for an unknown time after the click, so its entry stays
// until removeStaleShareDownloads reclaims it.
export function offerShareDownload(outcome: ShareDownloadOutcome, name: string): void {
    if (outcome.kind !== 'file') return;

    if (offeredUrl) URL.revokeObjectURL(offeredUrl);
    offeredUrl = URL.createObjectURL(outcome.file);

    const anchor = document.createElement('a');
    anchor.href = offeredUrl;
    anchor.download = name;
    anchor.click();
}

export function downloadShareFile(
    token: string,
    file: ShareFile,
    options: ShareDownloadOptions = {}
): AsyncResult<ShareDownloadOutcome, ApplicationError> {
    return createShareDownloadWorker().andThenAsync((worker) => run(worker, token, file, options));
}
