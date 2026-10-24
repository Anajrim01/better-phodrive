import { openAsBlob } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '../errors';
import type { UploadedChunk } from '../files';
import { UploadEventType, type UploadEvent } from '../models';
import { uploadFiles as uploadChunks } from '../browser/upload/index';
import type { ChunkTransport } from '../browser/upload/request';
import type { UploadJob } from '../browser/upload/jobs';
import type { Fetcher } from '../server/fetcher';
import { receiveChunk } from '../server/upload/input';
import { uploadFiles as forwardChunk } from '../server/upload/index';

export type TransferOptions = { signal?: AbortSignal; fetcher?: Fetcher };
export type LocalFile = { path: string; file: File };

function readFailure(path: string): ApplicationError {
    return { code: 'FILE_READ_FAILED', message: `Could not read ${path}.` };
}

/** Forward chunks to Google Photos in this process, reporting the same events as the HTTP API. */
export function localChunkTransport({ signal, fetcher }: TransferOptions = {}): ChunkTransport {
    return (metadata, payload, onEvent) =>
        Ok(undefined).andThenAsync(async () => {
            const abort = new AbortController();
            const onAbort = () => abort.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) abort.abort();

            // Stop the provider transfer as soon as the uploader rejects an event.
            const failures: ApplicationError[] = [];
            const emit = (event: UploadEvent) => {
                if (failures.length) return;

                onEvent(event).inspectErr((error) => {
                    failures.push(error);
                    abort.abort();
                });
            };

            try {
                const uploaded = await receiveChunk(
                    metadata,
                    payload.stream(),
                    abort.signal
                ).andThenAsync(async (input) => {
                    const forwarded = await forwardChunk(input, emit, fetcher);

                    const cancelled = await input.cancel();

                    return forwarded.andThen(() => cancelled);
                });

                const failure = failures[0];
                if (failure) return Err(failure);

                return uploaded.match({
                    Ok: () => onEvent({ type: UploadEventType.Complete }),
                    Err: (error) => onEvent({ type: UploadEventType.Error, error: error.message })
                });
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
        });
}

function listFolder(path: string): AsyncResult<string[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const entries = await readdir(path, { recursive: true, withFileTypes: true });

            const files = entries
                .filter((entry) => entry.isFile())
                .map((entry) => join(entry.parentPath, entry.name));

            return Ok(files.sort());
        } catch {
            return Err(readFailure(path));
        }
    });
}

function openFile(path: string): AsyncResult<LocalFile, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const blob = await openAsBlob(path);

            // Disk-backed blobs are read lazily, so large files are never loaded into memory.
            return Ok({ path, file: new File([blob], basename(path)) });
        } catch {
            return Err(readFailure(path));
        }
    });
}

function expandPath(path: string): AsyncResult<string[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let isFolder: boolean;

        try {
            const stats = await stat(path);
            if (!stats.isFile() && !stats.isDirectory())
                return Err({
                    code: 'FILE_READ_FAILED',
                    message: `${path} is not a file or folder.`
                } as const);

            isFolder = stats.isDirectory();
        } catch {
            return Err(readFailure(path));
        }

        if (!isFolder) return Ok([path]);

        return await listFolder(path);
    });
}

function openFiles(
    paths: readonly string[],
    files: LocalFile[]
): AsyncResult<LocalFile[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        for (const path of paths) {
            const opened = await openFile(path);
            if (opened.isErr()) return opened;

            opened.inspect((file) => files.push(file));
        }

        return Ok(files);
    });
}

/** Open files and every file below folders, flattening names as the web app does. */
export function openLocalFiles(
    paths: readonly string[]
): AsyncResult<LocalFile[], ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const files: LocalFile[] = [];

        for (const path of paths) {
            const opened = await expandPath(path).andThenAsync((found) => openFiles(found, files));
            if (opened.isErr()) return opened;
        }

        return Ok(files);
    });
}

/** Upload local files with the web app's hashing, chunking, deduplication, and worker pool. */
export function uploadFiles(
    files: readonly File[],
    email: string,
    token: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void,
    options: TransferOptions = {}
): AsyncResult<void, ApplicationError> {
    return uploadChunks(files, email, token, workers, onJob, onChunk, localChunkTransport(options));
}
