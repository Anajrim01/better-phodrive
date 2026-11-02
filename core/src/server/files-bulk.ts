import { isThrottleError, throttleError, type ServerError, type ThrottleMode } from './errors';
import {
    type BulkDeleteChunk,
    type BulkDeleteFileEvent,
    type BulkDeleteRequest
} from '../bulk-delete';
import pLimit from 'p-limit';
import { Ok, type AsyncResult } from 'results-ts';
import { moveToTrash, moveToTrashBatch } from './photos/index';
import { markChunksTrashed } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';
import { limitWorkers } from './workers';
import {
    validateBulkDelete,
    type BulkDeleteValidation,
    type ValidatedBulkFile
} from './files-bulk-validate';

export {
    validateBulkDelete,
    type BulkDeleteInvalidFile,
    type BulkDeleteValidation,
    type ValidatedBulkFile
} from './files-bulk-validate';

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

type ThrottleFailure = Extract<ServerError, { code: 'THROTTLED' }>;

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

function recordChunk(state: BulkFileState, chunk: BulkDeleteChunk, trashedAt: number): void {
    state.remaining--;
    state.deleted.push({ ...chunk, trashedAt });
}

function recordFailure(state: BulkFileState, error: ServerError): void {
    state.remaining--;
    state.failures.push(error);
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

        if (failure) recordFailure(state, failure);
        else recordChunk(state, chunk, trashedAt);
    }
}

async function trashEach(
    input: BulkDeleteRequest,
    files: readonly ValidatedBulkFile[],
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
            emitCompletedFiles(files, states, onFile, mode);

            return;
        }

        const moved = await moveToTrash(input.email, input.token, chunk.sha1, fetcher);
        const trashedAt = Date.now();
        const failure = moved.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (failure) {
            if (isThrottleError(failure)) stopped = failure;
            recordFailure(state, failure);
        } else {
            markChunksTrashed(input.email, [chunk], trashedAt);
            recordChunk(state, chunk, trashedAt);
        }

        emitCompletedFiles(files, states, onFile, mode);
    });

    return stopped;
}

function emitCompletedFiles(
    files: readonly ValidatedBulkFile[],
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
            index: file.index,
            name: file.name,
            deleted: state.deleted,
            ...failureFields(state.failures, mode)
        });
    }
}

export function trashValidatedFiles(
    input: BulkDeleteRequest,
    validation: BulkDeleteValidation,
    onFile: (result: BulkDeleteFileResult) => void,
    mode: ThrottleMode = 'auto',
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        for (const invalid of validation.invalid)
            onFile({
                index: invalid.index,
                name: invalid.name,
                deleted: [],
                error: invalid.error
            });

        const files = validation.files;
        const states: BulkFileState[] = files.map((file) => ({
            deleted: [],
            failures: [],
            remaining: file.chunks.length,
            emitted: false
        }));
        const entries = files.flatMap((file, fileIndex) =>
            file.chunks.map((chunk) => ({ fileIndex, chunk }))
        );
        let stopped: ThrottleFailure | null = null;

        for (let offset = 0; offset < entries.length; offset += BULK_TRASH_BATCH_SIZE) {
            const batch = entries.slice(offset, offset + BULK_TRASH_BATCH_SIZE);
            const trashedAt = Date.now();
            if (stopped) {
                const throttle = stopped;
                finishBatch(
                    input,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, throttle])),
                    trashedAt
                );
                emitCompletedFiles(files, states, onFile, mode);

                continue;
            }

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
                stopped = failure;
                finishBatch(
                    input,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, failure])),
                    trashedAt
                );
            } else {
                const fallbackThrottle = await trashEach(
                    input,
                    files,
                    states,
                    batch,
                    fetcher,
                    onFile,
                    mode
                );
                if (fallbackThrottle) stopped = fallbackThrottle;
            }

            emitCompletedFiles(files, states, onFile, mode);
        }

        return Ok(undefined);
    });
}

export function deleteFiles(
    input: BulkDeleteRequest,
    onFile: (result: BulkDeleteFileResult) => void,
    mode: ThrottleMode = 'auto',
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return validateBulkDelete(input, fetcher).andThenAsync((validation) =>
        trashValidatedFiles(input, validation, onFile, mode, fetcher)
    );
}
