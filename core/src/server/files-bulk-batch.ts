import { isThrottleError, throttleError, type ServerError, type ThrottleMode } from './errors';
import type {
    BulkDeleteAction,
    BulkDeleteChunk,
    BulkDeleteFile,
    BulkDeleteFileEvent,
    BulkDeleteRequest
} from '../bulk-delete';
import { FileActionKind } from '../models';
import { markChunksRestored, markChunksTrashed, removeChunks } from './photos/library/state';

export type BulkDeleteFileResult = Omit<BulkDeleteFileEvent, 'type'>;

export type BulkFileState = {
    deleted: BulkDeleteFileEvent['deleted'];
    failures: ServerError[];
    remaining: number;
    emitted: boolean;
};

export type ChunkEntry = { fileIndex: number; chunk: BulkDeleteChunk };

export type ChunkFailures = ReadonlyMap<BulkDeleteChunk, ServerError>;

export function failureFields(
    failures: readonly ServerError[],
    mode: ThrottleMode
): Pick<BulkDeleteFileResult, 'error' | 'retryAfterSeconds'> {
    const failure = failures.find(isThrottleError) ?? failures[0];
    if (!failure) return {};
    if (!isThrottleError(failure)) return { error: failure.message };

    const throttled = throttleError(failure.retryAfterSeconds, mode);

    return { error: throttled.message, retryAfterSeconds: failure.retryAfterSeconds };
}

export function applyState(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    chunks: readonly BulkDeleteChunk[],
    now: number
): void {
    if (chunks.length === 0) return;

    if (action === FileActionKind.Delete) {
        markChunksTrashed(input.email, chunks, now);

        return;
    }

    if (action === FileActionKind.DeleteForever) {
        removeChunks(input.email, chunks, now);

        return;
    }

    markChunksRestored(input.email, chunks, now);
}

function affectedChunk(
    chunk: BulkDeleteChunk,
    action: BulkDeleteAction,
    now: number
): BulkDeleteFileEvent['deleted'][number] {
    return action === FileActionKind.Delete ? { ...chunk, trashedAt: now } : { ...chunk };
}

export function recordChunk(
    state: BulkFileState,
    chunk: BulkDeleteChunk,
    action: BulkDeleteAction,
    now: number
): void {
    state.remaining--;
    state.deleted.push(affectedChunk(chunk, action, now));
}

export function recordFailure(state: BulkFileState, error: ServerError): void {
    state.remaining--;
    state.failures.push(error);
}

export function finishBatch(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    states: BulkFileState[],
    batch: readonly ChunkEntry[],
    confirmed: readonly BulkDeleteChunk[],
    failures: ChunkFailures,
    now: number
): void {
    applyState(input, action, confirmed, now);

    for (const { fileIndex, chunk } of batch) {
        const state = states[fileIndex];
        const failure = failures.get(chunk);

        if (failure) recordFailure(state, failure);
        else recordChunk(state, chunk, action, now);
    }
}

export function emitCompletedFiles(
    files: readonly BulkDeleteFile[],
    states: BulkFileState[],
    onFile: (result: BulkDeleteFileResult) => void,
    action: BulkDeleteAction,
    mode: ThrottleMode
): void {
    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const state = states[index];
        if (state.emitted || state.remaining > 0) continue;

        state.emitted = true;
        onFile({
            index,
            name: file.name,
            action,
            deleted: state.deleted,
            ...failureFields(state.failures, mode)
        });
    }
}
