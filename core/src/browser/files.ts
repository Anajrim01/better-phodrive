import type { ApplicationError } from '../errors';
import { throttleMessage } from './upload/eta';
import {
    FileActionKind,
    ConcurrentWorkersSchema,
    FileDeleteResponseSchema,
    FileRestoreResponseSchema
} from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { incompleteFileMessage, type FileGroup, type UploadedChunk } from '../files';
import { schemaResult } from '../validation';
import { apiJson, request } from './api';

export { createUploadJobs, type UploadJob } from './upload/jobs';

export type { UploadProgress } from '../models';
export { uploadFiles } from './upload/index';

const FILES_API_URL = '/api/files';

function chunksFor(item: FileGroup, action: FileActionKind): UploadedChunk[] {
    if (action === FileActionKind.Delete) return [...item.chunks, ...item.duplicates];
    if (action === FileActionKind.Restore)
        return item.trashed
            ? item.trashedChunks
            : item.trashedChunks.filter(
                  (trashed) =>
                      !item.chunks.some((active) => active.chunkIndex === trashed.chunkIndex)
              );
    if (action === FileActionKind.DeleteForever) return item.trashedChunks;

    return item.chunks;
}

function fileRequest(
    item: FileGroup,
    action: FileActionKind,
    token: string,
    workers: number
): RequestInit {
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            action,
            email: item.email,
            token,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunks: chunksFor(item, action),
            workers
        })
    };
}

export function deleteFile(
    item: FileGroup,
    token: string,
    onTrashed: (chunk: UploadedChunk) => void,
    workers: number
): AsyncResult<void, ApplicationError> {
    return schemaResult(ConcurrentWorkersSchema, workers, 'Invalid concurrent worker count.')
        .andThenAsync((concurrency) =>
            apiJson(
                FILES_API_URL,
                fileRequest(item, FileActionKind.Delete, token, concurrency),
                'Delete failed'
            )
        )
        .andThen((data) => schemaResult(FileDeleteResponseSchema, data, 'Delete failed'))
        .andThen(({ deleted, error, retryAfterSeconds }): Result<void, ApplicationError> => {
            const knownChunks = [...item.chunks, ...item.duplicates];
            for (const chunk of deleted) {
                const known = knownChunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known)
                    return Err({
                        code: 'INVALID_DELETE_RESPONSE',
                        message: 'Invalid delete response.'
                    } as const);

                onTrashed({ ...known, trashedAt: chunk.trashedAt });
            }

            if (retryAfterSeconds !== undefined)
                return Err({
                    code: 'THROTTLED',
                    message: `Deleted ${deleted.length} of ${knownChunks.length} chunks. ${throttleMessage(retryAfterSeconds, 'try again')}`,
                    retryAfterSeconds
                });

            return error ? Err({ code: 'DELETE_FAILED', message: error } as const) : Ok(undefined);
        });
}

export function restoreFile(
    item: FileGroup,
    token: string,
    onRestored: (chunk: UploadedChunk) => void
): AsyncResult<void, ApplicationError> {
    return apiJson(
        FILES_API_URL,
        fileRequest(item, FileActionKind.Restore, token, 1),
        'Restore failed'
    )
        .andThen((data) => schemaResult(FileRestoreResponseSchema, data, 'Restore failed'))
        .andThen(({ restored }): Result<void, ApplicationError> => {
            for (const chunk of restored) {
                const known = item.trashedChunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known)
                    return Err({
                        code: 'INVALID_RESTORE_RESPONSE',
                        message: 'Invalid restore response.'
                    } as const);

                onRestored({ ...known, trashedAt: undefined });
            }

            return Ok(undefined);
        });
}

export function deleteForeverFile(
    item: FileGroup,
    token: string,
    onDeleted: (chunk: UploadedChunk) => void,
    workers: number
): AsyncResult<void, ApplicationError> {
    return schemaResult(ConcurrentWorkersSchema, workers, 'Invalid concurrent worker count.')
        .andThenAsync((concurrency) =>
            apiJson(
                FILES_API_URL,
                fileRequest(item, FileActionKind.DeleteForever, token, concurrency),
                'Permanent delete failed'
            )
        )
        .andThen((data) => schemaResult(FileDeleteResponseSchema, data, 'Permanent delete failed'))
        .andThen(({ deleted }): Result<void, ApplicationError> => {
            for (const chunk of deleted) {
                const known = item.trashedChunks.find(
                    (current) => current.mediaKey === chunk.mediaKey && current.sha1 === chunk.sha1
                );
                if (!known)
                    return Err({
                        code: 'INVALID_DELETE_RESPONSE',
                        message: 'Invalid delete response.'
                    } as const);

                onDeleted(known);
            }

            return Ok(undefined);
        });
}

export function downloadFile(item: FileGroup, token: string): AsyncResult<Blob, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!item.complete || item.chunkCount === null)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: incompleteFileMessage(item)
            } as const);

        return request(
            FILES_API_URL,
            fileRequest(item, FileActionKind.Download, token, 1),
            'Download failed'
        ).andThenAsync(async (response) => {
            try {
                const file = await response.blob();

                return Ok(file);
            } catch {
                return Err({
                    code: 'DOWNLOAD_RECEIVE_FAILED',
                    message:
                        'Download was interrupted, possibly because Google Photos is limiting requests. Try again.'
                } as const);
            }
        });
    });
}
