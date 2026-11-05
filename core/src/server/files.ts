import { SERVER_ERRORS, type ServerError } from './errors';
import { FileActionKind, FileNameSchema, type FileRequest, type RemoteBmp } from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    mutatePhotos,
    type ChunkMetadataStore,
    type MutationKind,
    type ThrottleScope
} from './photos/index';
import type { Fetcher } from './fetcher';
import { photosFetch } from './fetcher';
import { streamDownload } from './download';

export type FileMutationResult = {
    applied: RemoteBmp[];
    error?: string;
    retryAfterSeconds?: number;
};

const MUTATION_KINDS: Partial<Record<FileActionKind, MutationKind>> = {
    [FileActionKind.Delete]: 'trash',
    [FileActionKind.Restore]: 'restore',
    [FileActionKind.DeleteForever]: 'delete'
};

function validateChunks(input: FileRequest): Result<RemoteBmp[], ServerError> {
    const chunks = input.chunks.toSorted((a, b) => a.chunkIndex - b.chunkIndex);
    if (
        !FileNameSchema.safeParse(input.name).success ||
        chunks.some((chunk) => chunk.fileHash !== input.fileHash || chunk.fileId !== input.fileId)
    )
        return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    if (input.action === FileActionKind.Delete) return Ok(chunks);

    if (input.action !== FileActionKind.Download) {
        if (!chunks.length || chunks.some((chunk) => !chunk.trashed))
            return Err(SERVER_ERRORS.NOT_TRASHED);

        return Ok(chunks);
    }

    if (
        chunks.length === 0 ||
        chunks.some(
            (chunk, index) =>
                chunk.trashed === true ||
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name) ||
                (index !== 0 && chunk.folder !== undefined)
        )
    )
        return Err(SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS);

    return Ok(chunks);
}

/** Reconstruct in order as the browser reads, verifying integrity before stream completion. */
export function downloadFile(
    input: FileRequest,
    signal?: AbortSignal
): AsyncResult<Response, ServerError> {
    return validateChunks(input).andThenAsync((chunks) => streamDownload(input, chunks, signal));
}

function mutationKind(action: FileActionKind): Result<MutationKind, ServerError> {
    const kind = MUTATION_KINDS[action];

    return kind ? Ok(kind) : Err(SERVER_ERRORS.INVALID_FILE_METADATA);
}

function mutateFile(
    input: FileRequest,
    scope: ThrottleScope,
    metadata?: ChunkMetadataStore,
    fetcher: Fetcher = photosFetch
): AsyncResult<FileMutationResult, ServerError> {
    return mutationKind(input.action).andThenAsync(async (kind) => {
        const valid = validateChunks(input);
        if (valid.isErr()) return valid;

        const result = await mutatePhotos(
            kind,
            { email: input.email, token: input.token },
            valid.unwrap(),
            scope,
            fetcher,
            kind === 'delete' && metadata
                ? (applied) => metadata.remove(applied.map((chunk) => chunk.mediaKey))
                : undefined
        );

        if (result.isErr()) {
            const failure = result.unwrapErr();

            return Ok({
                applied: [],
                error: failure.message,
                ...('retryAfterSeconds' in failure
                    ? { retryAfterSeconds: failure.retryAfterSeconds }
                    : {})
            });
        }

        const { applied, failure } = result.unwrap();

        return Ok({
            applied,
            ...(failure
                ? {
                      error: failure.message,
                      ...('retryAfterSeconds' in failure
                          ? { retryAfterSeconds: failure.retryAfterSeconds }
                          : {})
                  }
                : {})
        });
    });
}

/** Move confirmed chunks to Google Photos trash and return only confirmed progress. */
export function deleteFile(
    input: FileRequest,
    scope: ThrottleScope,
    fetcher: Fetcher = photosFetch
): AsyncResult<FileMutationResult, ServerError> {
    return mutateFile(input, scope, undefined, fetcher);
}

/** Restore confirmed trashed chunks without changing their stored identity. */
export function restoreFile(
    input: FileRequest,
    scope: ThrottleScope,
    fetcher: Fetcher = photosFetch
): AsyncResult<FileMutationResult, ServerError> {
    return mutateFile(input, scope, undefined, fetcher);
}

/** Permanently delete confirmed trashed chunks, then remove their metadata rows. */
export function deleteForeverFile(
    input: FileRequest,
    scope: ThrottleScope,
    metadata?: ChunkMetadataStore,
    fetcher: Fetcher = photosFetch
): AsyncResult<FileMutationResult, ServerError> {
    return mutateFile(input, scope, metadata, fetcher);
}
