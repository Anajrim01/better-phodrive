import {
    SERVER_ERRORS,
    isThrottleError,
    throttleError,
    type ServerError,
    type ThrottleMode
} from './errors';
import {
    BulkDeleteRequestSchema,
    type BulkDeleteFile,
    type BulkDeleteFileEvent,
    type BulkDeleteRequest
} from '../bulk-delete';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { moveToTrashBatch } from './photos/index';
import { markChunksTrashed } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';

export const BULK_TRASH_BATCH_SIZE = 500;

export type BulkDeleteFileResult = Omit<BulkDeleteFileEvent, 'type'>;

type BulkFileState = {
    deleted: BulkDeleteFileEvent['deleted'];
    failures: ServerError[];
    remaining: number;
    emitted: boolean;
};

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
            const trashedAt = Date.now();

            moved.match({
                Ok: () => {
                    markChunksTrashed(
                        input.email,
                        batch.map(({ chunk }) => chunk),
                        trashedAt
                    );
                    for (const { fileIndex, chunk } of batch) {
                        states[fileIndex].deleted.push({ ...chunk, trashedAt });
                        states[fileIndex].remaining--;
                    }
                },
                Err: (error) => {
                    for (const { fileIndex } of batch) {
                        states[fileIndex].failures.push(error);
                        states[fileIndex].remaining--;
                    }
                }
            });

            emitCompletedFiles(files, states, onFile, mode);
        }

        return Ok(undefined);
    });
}
