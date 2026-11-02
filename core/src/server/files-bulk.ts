import {
    SERVER_ERRORS,
    isThrottleError,
    throttleError,
    type ServerError,
    type ThrottleMode
} from './errors';
import {
    BulkDeleteRequestSchema,
    type BulkDeleteChunk,
    type BulkDeleteFile,
    type BulkDeleteFileEvent,
    type BulkDeleteRequest
} from '../bulk-delete';
import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { moveToTrash, moveToTrashBatch } from './photos/index';
import { markChunksTrashed } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';
import { limitWorkers } from './workers';

export const BULK_TRASH_BATCH_SIZE = 500;

export type BulkDeleteFileResult = Omit<BulkDeleteFileEvent, 'type'>;

type BulkFileState = {
    deleted: BulkDeleteFileEvent['deleted'];
    failures: ServerError[];
    remaining: number;
    emitted: boolean;
};

type ChunkEntry = { fileIndex: number; chunk: BulkDeleteChunk };

type ChunkFailures = ReadonlyMap<BulkDeleteChunk, ServerError>;

export function validateBulkDelete(
    input: BulkDeleteRequest
): Result<BulkDeleteFile[], ServerError> {
    const parsed = BulkDeleteRequestSchema.safeParse(input);
    if (!parsed.success) return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    return Ok(parsed.data.files);
}

function failureFields(
    failures: readonly ServerError[],
    mode: ThrottleMode
): Pick<BulkDeleteFileResult, 'error' | 'retryAfterSeconds'> {
    const failure = failures.find(isThrottleError) ?? failures[0];
    if (!failure) return {};
    if (!isThrottleError(failure)) return { error: failure.message };

    const throttled = throttleError(failure.retryAfterSeconds, mode);

    return { error: throttled.message, retryAfterSeconds: failure.retryAfterSeconds };
}

function finishBatch(
    input: BulkDeleteRequest,
    states: BulkFileState[],
    batch: readonly ChunkEntry[],
    confirmed: readonly BulkDeleteChunk[],
    failures: ChunkFailures,
    trashedAt: number
): void {
    if (confirmed.length > 0) markChunksTrashed(input.email, confirmed, trashedAt);

    for (const { fileIndex, chunk } of batch) {
        const state = states[fileIndex];
        const failure = failures.get(chunk);

        state.remaining--;
        if (failure) state.failures.push(failure);
        else state.deleted.push({ ...chunk, trashedAt });
    }
}

async function trashEach(
    input: BulkDeleteRequest,
    batch: readonly ChunkEntry[],
    fetcher: Fetcher
): Promise<{ confirmed: BulkDeleteChunk[]; failures: Map<BulkDeleteChunk, ServerError> }> {
    const limit = pLimit(limitWorkers(input.workers));
    const outcomes = await limit.map(batch, async ({ chunk }) => {
        const moved = await moveToTrash(input.email, input.token, chunk.sha1, fetcher);

        return moved.match<{ chunk: BulkDeleteChunk; error?: ServerError }>({
            Ok: () => ({ chunk }),
            Err: (error) => ({ chunk, error })
        });
    });
    const confirmed: BulkDeleteChunk[] = [];
    const failures = new Map<BulkDeleteChunk, ServerError>();

    for (const outcome of outcomes) {
        if (outcome.error) failures.set(outcome.chunk, outcome.error);
        else confirmed.push(outcome.chunk);
    }

    return { confirmed, failures };
}

function emitCompletedFiles(
    files: readonly BulkDeleteFile[],
    states: BulkFileState[],
    onFile: (result: BulkDeleteFileResult) => void,
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
            deleted: state.deleted,
            ...failureFields(state.failures, mode)
        });
    }
}

export function deleteFiles(
    input: BulkDeleteRequest,
    onFile: (result: BulkDeleteFileResult) => void,
    mode: ThrottleMode = 'auto',
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return validateBulkDelete(input).andThenAsync(async (files) => {
        const states: BulkFileState[] = files.map((file) => ({
            deleted: [],
            failures: [],
            remaining: file.chunks.length,
            emitted: false
        }));
        const entries = files.flatMap((file, fileIndex) =>
            file.chunks.map((chunk) => ({ fileIndex, chunk }))
        );

        for (let offset = 0; offset < entries.length; offset += BULK_TRASH_BATCH_SIZE) {
            const batch = entries.slice(offset, offset + BULK_TRASH_BATCH_SIZE);
            const moved = await moveToTrashBatch(
                input.email,
                input.token,
                batch.map(({ chunk }) => chunk.sha1),
                fetcher
            );
            const failure = moved.match<ServerError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            const trashedAt = Date.now();

            if (failure === null) {
                finishBatch(
                    input,
                    states,
                    batch,
                    batch.map(({ chunk }) => chunk),
                    new Map(),
                    trashedAt
                );
            } else if (isThrottleError(failure)) {
                finishBatch(
                    input,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, failure])),
                    trashedAt
                );
            } else {
                const retried = await trashEach(input, batch, fetcher);
                finishBatch(input, states, batch, retried.confirmed, retried.failures, trashedAt);
            }

            emitCompletedFiles(files, states, onFile, mode);
        }

        return Ok(undefined);
    });
}
