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
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import {
    markChunksTrashed,
    readAccountState,
    type LibraryAccountState
} from './photos/library/state';
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

type ThrottleFailure = Extract<ServerError, { code: 'THROTTLED' }>;

function validateState(
    files: BulkDeleteRequest['files'],
    state: LibraryAccountState
): Result<BulkDeleteFile[], ServerError> {
    const validated: BulkDeleteFile[] = [];

    for (const [name, fileHash, fileId, pairs] of files) {
        const chunks = pairs.map(([mediaKey, sha1]) => ({ mediaKey, sha1 }));

        for (const chunk of chunks) {
            const stored = state.items.get(chunk.mediaKey);
            if (
                !stored ||
                stored.sha1 !== chunk.sha1 ||
                stored.fileHash !== fileHash ||
                stored.fileId !== fileId
            )
                return Err(SERVER_ERRORS.INVALID_FILE_METADATA);
        }

        validated.push({ name, fileHash, fileId, chunks });
    }

    return Ok(validated);
}

export function validateBulkDelete(
    input: BulkDeleteRequest,
    fetcher: Fetcher = photosFetch
): AsyncResult<BulkDeleteFile[], ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const parsed = BulkDeleteRequestSchema.safeParse(input);
        if (!parsed.success) return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

        const built = !readAccountState(input.email);
        if (built) {
            const ensured = await ensureAccountIndex(input.email, input.token, fetcher);
            const ensureError = ensured.match<ServerError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            if (ensureError) return Err(ensureError);
        }

        const state = readAccountState(input.email);
        if (!state) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        const initial = validateState(parsed.data.files, state);
        if (initial.isOk() || built) return initial;

        const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
        const refreshError = refreshed.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (refreshError) return Err(refreshError);

        const next = readAccountState(input.email);
        if (!next) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        return validateState(parsed.data.files, next);
    });
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
    return validateBulkDelete(input, fetcher).andThenAsync(async (files) => {
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
