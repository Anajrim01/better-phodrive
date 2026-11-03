import {
    SERVER_ERRORS,
    isThrottleError,
    throttleError,
    type ServerError,
    type ThrottleMode
} from './errors';
import { FileActionKind, FileNameSchema, type FileRequest, type RemoteBmp } from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { expectedChunks, incompleteChunkMessage, missingChunks } from '../files';
import { deletePermanently, moveToTrashBatch, restoreFromTrash } from './photos/index';
import { markChunksRestored, markChunksTrashed, removeChunks } from './photos/library/state';
import { streamDownload } from './download';
import { validateTrashedFileState } from './files-state-validation';
import { BULK_TRASH_BATCH_SIZE } from './files-bulk';

export {
    BULK_TRASH_BATCH_SIZE,
    deleteFiles,
    trashValidatedFiles,
    validateBulkDelete,
    type BulkDeleteFileResult,
    type BulkDeleteInvalidFile,
    type BulkDeleteValidation,
    type ValidatedBulkFile
} from './files-bulk';

function incompleteDownloadError(chunks: readonly RemoteBmp[]): ServerError {
    const expected = expectedChunks(chunks);
    const missing = expected === null ? 0 : missingChunks(chunks, expected);
    if (expected === null || missing === 0) return SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS;

    return {
        ...SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS,
        message: incompleteChunkMessage(expected, missing)
    };
}

function validateChunks(input: FileRequest): Result<RemoteBmp[], ServerError> {
    const chunks = input.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    if (
        !FileNameSchema.safeParse(input.name).success ||
        chunks.some((chunk) => chunk.fileHash !== input.fileHash || chunk.fileId !== input.fileId)
    )
        return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    if (input.action !== FileActionKind.Download) {
        if (chunks.length === 0) return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

        return Ok(chunks);
    }
    if (
        chunks.length === 0 ||
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name)
        )
    )
        return Err(incompleteDownloadError(chunks));

    return Ok(chunks);
}

function requireTrashed(chunks: RemoteBmp[]): Result<RemoteBmp[], ServerError> {
    if (chunks.some((chunk) => chunk.trashedAt === undefined))
        return Err(SERVER_ERRORS.NOT_TRASHED);

    return Ok(chunks);
}

/** Reconstruct in order as the browser reads, verifying integrity before stream completion. */
export function downloadFile(
    input: FileRequest,
    signal?: AbortSignal,
    mode: ThrottleMode = 'auto'
): AsyncResult<Response, ServerError> {
    return validateChunks(input).andThenAsync((chunks) =>
        streamDownload(input, chunks, signal, mode)
    );
}

/** Attempt every known chunk and return all confirmed trash moves even after partial failure. */
export function deleteFile(
    input: FileRequest,
    mode: ThrottleMode = 'auto'
): AsyncResult<{ deleted: RemoteBmp[]; error?: string; retryAfterSeconds?: number }, ServerError> {
    return validateChunks(input).andThenAsync(async (chunks) => {
        const deleted: RemoteBmp[] = [];
        const failures: ServerError[] = [];

        for (let offset = 0; offset < chunks.length; offset += BULK_TRASH_BATCH_SIZE) {
            const batch = chunks.slice(offset, offset + BULK_TRASH_BATCH_SIZE);
            const removed = await moveToTrashBatch(
                input.email,
                input.token,
                batch.map((chunk) => chunk.sha1),
                undefined,
                batch.map((chunk) => chunk.mediaKey)
            );

            removed.match({
                Ok: () => {
                    deleted.push(...batch);
                },
                Err: (error) => {
                    failures.push(error);
                }
            });
            if (failures.some(isThrottleError)) break;
        }

        const now = Date.now();
        if (deleted.length > 0) markChunksTrashed(input.email, deleted, now);
        const trashed = deleted.map((chunk) => ({ ...chunk, trashedAt: now }));

        const failure = failures.find(isThrottleError) ?? failures[0];
        const failureMessage = failure
            ? isThrottleError(failure)
                ? throttleError(failure.retryAfterSeconds, mode).message
                : failure.message
            : undefined;

        return Ok({
            deleted: trashed,
            ...(failureMessage ? { error: failureMessage } : {}),
            ...(failure && isThrottleError(failure)
                ? { retryAfterSeconds: failure.retryAfterSeconds }
                : {})
        });
    });
}

function untrashed(chunk: RemoteBmp): RemoteBmp {
    const copy = { ...chunk };
    delete copy.trashedAt;

    return copy;
}

/** Restore the selected chunks from Google Photos trash and clear their local mark. */
export function restoreFile(
    input: FileRequest,
    mode: ThrottleMode = 'auto'
): AsyncResult<{ restored: RemoteBmp[]; error?: string; retryAfterSeconds?: number }, ServerError> {
    return validateChunks(input)
        .andThen((chunks) => requireTrashed(chunks))
        .andThenAsync((chunks) => validateTrashedFileState(input, chunks).map(() => chunks))
        .andThenAsync(async (chunks) => {
            const restored: RemoteBmp[] = [];
            const failures: ServerError[] = [];

            for (let offset = 0; offset < chunks.length; offset += BULK_TRASH_BATCH_SIZE) {
                const batch = chunks.slice(offset, offset + BULK_TRASH_BATCH_SIZE);
                const sha1s = [...new Set(batch.map((chunk) => chunk.sha1))];
                const applied = await restoreFromTrash(
                    input.email,
                    input.token,
                    sha1s,
                    undefined,
                    batch.map((chunk) => chunk.mediaKey)
                );

                applied.match({
                    Ok: () => {
                        restored.push(...batch);
                    },
                    Err: (error) => {
                        failures.push(error);
                    }
                });
                if (failures.some(isThrottleError)) break;
            }

            if (restored.length > 0) markChunksRestored(input.email, restored);
            const failure = failures.find(isThrottleError) ?? failures[0];
            if (failure && restored.length === 0)
                return Err(
                    isThrottleError(failure)
                        ? throttleError(failure.retryAfterSeconds, mode)
                        : failure
                );

            return Ok({
                restored: restored.map(untrashed),
                ...(failure && !isThrottleError(failure) ? { error: failure.message } : {}),
                ...(failure && isThrottleError(failure)
                    ? {
                          error: throttleError(failure.retryAfterSeconds, mode).message,
                          retryAfterSeconds: failure.retryAfterSeconds
                      }
                    : {})
            });
        });
}

/** Permanently delete the selected chunks and drop them from the local index. */
export function deleteForeverFile(
    input: FileRequest,
    mode: ThrottleMode = 'auto'
): AsyncResult<{ deleted: RemoteBmp[]; error?: string; retryAfterSeconds?: number }, ServerError> {
    return validateChunks(input)
        .andThen((chunks) => requireTrashed(chunks))
        .andThenAsync((chunks) => validateTrashedFileState(input, chunks).map(() => chunks))
        .andThenAsync(async (chunks) => {
            const deleted: RemoteBmp[] = [];
            const failures: ServerError[] = [];

            for (let offset = 0; offset < chunks.length; offset += BULK_TRASH_BATCH_SIZE) {
                const batch = chunks.slice(offset, offset + BULK_TRASH_BATCH_SIZE);
                const sha1s = [...new Set(batch.map((chunk) => chunk.sha1))];
                const applied = await deletePermanently(
                    input.email,
                    input.token,
                    sha1s,
                    undefined,
                    batch.map((chunk) => chunk.mediaKey)
                );

                applied.match({
                    Ok: () => {
                        deleted.push(...batch);
                    },
                    Err: (error) => {
                        failures.push(error);
                    }
                });
                if (failures.some(isThrottleError)) break;
            }

            if (deleted.length > 0) removeChunks(input.email, deleted);
            const failure = failures.find(isThrottleError) ?? failures[0];
            if (failure && deleted.length === 0)
                return Err(
                    isThrottleError(failure)
                        ? throttleError(failure.retryAfterSeconds, mode)
                        : failure
                );

            return Ok({
                deleted,
                ...(failure && !isThrottleError(failure) ? { error: failure.message } : {}),
                ...(failure && isThrottleError(failure)
                    ? {
                          error: throttleError(failure.retryAfterSeconds, mode).message,
                          retryAfterSeconds: failure.retryAfterSeconds
                      }
                    : {})
            });
        });
}
