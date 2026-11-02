import { isThrottleError, type ServerError, type ThrottleMode } from './errors';
import type { BulkDeleteAction, BulkDeleteFile, BulkDeleteRequest } from '../bulk-delete';
import { FileActionKind } from '../models';
import pLimit from 'p-limit';
import { Ok, type AsyncResult } from 'results-ts';
import { deletePermanently, moveToTrash, moveToTrashBatch, restoreFromTrash } from './photos/index';
import {
    applyState,
    emitCompletedFiles,
    recordChunk,
    recordFailure,
    type BulkDeleteFileResult,
    type BulkFileState,
    type ChunkEntry
} from './files-bulk-batch';
import { photosFetch, type Fetcher } from './fetcher';
import { limitWorkers } from './workers';

export type ThrottleFailure = Extract<ServerError, { code: 'THROTTLED' }>;

function actionStage(action: BulkDeleteAction): string {
    if (action === FileActionKind.DeleteForever) return 'Delete permanently';
    if (action === FileActionKind.Restore) return 'Restore from trash';

    return 'Move to trash';
}

export function canFallBack(error: ServerError, action: BulkDeleteAction): boolean {
    return (
        error.code === 'REQUEST_FAILED' &&
        error.stage === actionStage(action) &&
        (error.status === 400 || error.status === 413)
    );
}

function applyBatch(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    sha1s: readonly string[],
    mediaKeys: readonly string[],
    fetcher: Fetcher
): AsyncResult<void, ServerError> {
    if (action === FileActionKind.Delete)
        return moveToTrashBatch(input.email, input.token, sha1s, fetcher, mediaKeys);

    if (action === FileActionKind.DeleteForever)
        return deletePermanently(input.email, input.token, sha1s, fetcher, mediaKeys);

    return restoreFromTrash(input.email, input.token, sha1s, fetcher, mediaKeys);
}

function applySingle(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    sha1: string,
    mediaKey: string,
    fetcher: Fetcher
): AsyncResult<void, ServerError> {
    if (action === FileActionKind.Delete)
        return moveToTrash(input.email, input.token, sha1, fetcher, mediaKey);

    if (action === FileActionKind.DeleteForever)
        return deletePermanently(input.email, input.token, [sha1], fetcher, [mediaKey]);

    return restoreFromTrash(input.email, input.token, [sha1], fetcher, [mediaKey]);
}

export function applyBatchAction(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    sha1s: readonly string[],
    mediaKeys: readonly string[],
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return applyBatch(input, action, sha1s, mediaKeys, fetcher);
}

export async function fallbackEach(
    input: BulkDeleteRequest,
    action: BulkDeleteAction,
    files: readonly BulkDeleteFile[],
    states: BulkFileState[],
    batch: readonly ChunkEntry[],
    fetcher: Fetcher,
    onFile: (result: BulkDeleteFileResult) => void,
    mode: ThrottleMode
): Promise<ThrottleFailure | null> {
    const limit = pLimit(limitWorkers(input.workers));
    let stopped: ThrottleFailure | null = null;

    await limit.map(batch, async ({ fileIndex, chunk }) => {
        const state = states[fileIndex];
        if (stopped) {
            recordFailure(state, stopped);
            emitCompletedFiles(files, states, onFile, action, mode);

            return;
        }

        const applied = await applySingle(input, action, chunk.sha1, chunk.mediaKey, fetcher);
        const now = Date.now();
        const failure = applied.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (failure) {
            if (isThrottleError(failure)) stopped = failure;
            recordFailure(state, failure);
        } else {
            applyState(input, action, [chunk], now);
            recordChunk(state, chunk, action, now);
        }

        emitCompletedFiles(files, states, onFile, action, mode);
    });

    return stopped;
}
