import type { ApplicationError } from '../errors';
import {
    FileActionKind,
    GOOGLE_ACCOUNT_HEADER,
    FileMutationResponseSchema,
    ProcessingMode
} from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup, UploadedChunk } from '../files';
import { schemaResult } from '../validation';
import { apiJson, request } from './api';
import { downloadChunks } from './download';

export { createUploadJobs, type UploadJob } from './upload/jobs';

export type { UploadProgress } from '../models';
export { uploadFiles } from './upload/index';

const FILES_API_URL = '/api/files';

function fileRequest(item: FileGroup, action: FileActionKind): RequestInit {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(item.accountId ? { [GOOGLE_ACCOUNT_HEADER]: item.accountId } : {})
        },
        body: JSON.stringify({
            action,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            // Chunks keep their owner locally; the request header selects the account.
            chunks: item.chunks.map(({ email: _email, accountId: _accountId, ...chunk }) => chunk)
        })
    };
}

type MutatingAction = FileActionKind.Delete | FileActionKind.Restore | FileActionKind.DeleteForever;

const FILE_ACTION_ERRORS = {
    [FileActionKind.Delete]: { code: 'DELETE_FAILED', message: 'Delete failed' },
    [FileActionKind.Restore]: { code: 'RESTORE_FAILED', message: 'Restore failed' },
    [FileActionKind.DeleteForever]: {
        code: 'DELETE_FOREVER_FAILED',
        message: 'Delete forever failed'
    }
} as const satisfies Record<MutatingAction, { code: ApplicationError['code']; message: string }>;

function mutateFile(
    item: FileGroup,
    action: MutatingAction,
    onApplied: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    const failure = FILE_ACTION_ERRORS[action];

    return apiJson(FILES_API_URL, fileRequest(item, action), failure.message)
        .andThen((data) => schemaResult(FileMutationResponseSchema, data, failure.message))
        .andThen(({ applied, error }): Result<void, ApplicationError> => {
            for (const chunk of applied) {
                const known = item.chunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known)
                    return Err({
                        code: 'INVALID_MUTATION_RESPONSE',
                        message: 'Invalid file action response.'
                    } as const);

                onApplied(known);
            }

            return error ? Err({ code: failure.code, message: error }) : Ok(undefined);
        });
}

export function deleteFile(
    item: FileGroup,
    onDeleted: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    return mutateFile(item, FileActionKind.Delete, onDeleted);
}

export function restoreFile(
    item: FileGroup,
    onRestored: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    return mutateFile(item, FileActionKind.Restore, onRestored);
}

export function deleteForeverFile(
    item: FileGroup,
    onDeleted: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    return mutateFile(item, FileActionKind.DeleteForever, onDeleted);
}

/** The server's processing mode decides whether chunks are decoded here or on the server. */
export function downloadFile(
    item: FileGroup,
    processing: ProcessingMode
): AsyncResult<Blob, ApplicationError> {
    if (item.chunks.some((chunk) => chunk.trashed))
        return Ok(undefined).andThenAsync<Blob, ApplicationError>(async () =>
            Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: 'Some chunks are unavailable. Restore them before downloading.'
            } as const)
        );

    if (processing === ProcessingMode.Browser) return downloadChunks(item);

    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: 'Load the remaining chunks before downloading.'
            } as const);

        return request(
            FILES_API_URL,
            fileRequest(item, FileActionKind.Download),
            'Download failed'
        ).andThenAsync(async (response) => {
            try {
                const file = await response.blob();

                return Ok(file);
            } catch {
                return Err({
                    code: 'DOWNLOAD_RECEIVE_FAILED',
                    message: 'Could not receive the downloaded file.'
                } as const);
            }
        });
    });
}
