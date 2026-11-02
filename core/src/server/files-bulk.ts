import { isThrottleError, type ServerError, type ThrottleMode } from './errors';
import type { BulkDeleteAction, BulkDeleteFileEvent, BulkDeleteRequest } from '../bulk-delete';
import { FileActionKind } from '../models';
import { Ok, type AsyncResult } from 'results-ts';
import {
    emitCompletedFiles,
    finishBatch,
    type BulkDeleteFileResult,
    type BulkFileState
} from './files-bulk-batch';
import {
    canFallBack,
    fallbackEach,
    applyBatchAction,
    type ThrottleFailure
} from './files-bulk-fallback';
import { validateBulkDelete, type BulkDeleteValidation } from './files-bulk-validation';
import { photosFetch, type Fetcher } from './fetcher';

export const BULK_TRASH_BATCH_SIZE = 500;

export { validateBulkDelete } from './files-bulk-validation';
export type { BulkDeleteFileResult } from './files-bulk-batch';
export type {
    BulkDeleteInvalidFile,
    BulkDeleteValidation,
    ValidatedBulkFile
} from './files-bulk-validation';

export function trashValidatedFiles(
    input: BulkDeleteRequest,
    validation: BulkDeleteValidation,
    onFile: (result: BulkDeleteFileResult) => void,
    mode: ThrottleMode = 'auto',
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const action: BulkDeleteAction = input.action ?? FileActionKind.Delete;
        for (const invalid of validation.invalid)
            onFile({
                index: invalid.index,
                name: invalid.name,
                action,
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
            const now = Date.now();
            if (stopped) {
                const throttle = stopped;
                finishBatch(
                    input,
                    action,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, throttle])),
                    now
                );
                emitCompletedFiles(files, states, onFile, action, mode);

                continue;
            }

            const applied = await applyBatchAction(
                input,
                action,
                batch.map(({ chunk }) => chunk.sha1),
                batch.map(({ chunk }) => chunk.mediaKey),
                fetcher
            );
            const failure = applied.match<ServerError | null>({
                Ok: () => null,
                Err: (error) => error
            });

            if (failure === null) {
                finishBatch(
                    input,
                    action,
                    states,
                    batch,
                    batch.map(({ chunk }) => chunk),
                    new Map(),
                    now
                );
            } else if (isThrottleError(failure)) {
                stopped = failure;
                finishBatch(
                    input,
                    action,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, failure])),
                    now
                );
            } else if (canFallBack(failure, action)) {
                const fallbackThrottle = await fallbackEach(
                    input,
                    action,
                    files,
                    states,
                    batch,
                    fetcher,
                    onFile,
                    mode
                );
                if (fallbackThrottle) stopped = fallbackThrottle;
            } else {
                finishBatch(
                    input,
                    action,
                    states,
                    batch,
                    [],
                    new Map(batch.map(({ chunk }) => [chunk, failure])),
                    now
                );
            }

            emitCompletedFiles(files, states, onFile, action, mode);
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
