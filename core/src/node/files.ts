import { randomUUID } from 'node:crypto';
import { lstat, open, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../errors';
import type { FileGroup } from '../files';
import { FileActionKind, FileRequestSchema, type FileRequest, type RemoteBmp } from '../models';
import { schemaResult } from '../validation';
import { SERVER_ERRORS, type ServerError } from '../server/errors';
import {
    deleteFile as deleteRemoteFile,
    downloadFile as downloadRemoteFile
} from '../server/files';
import { validateWorkers } from '../server/workers';

export type DownloadOptions = {
    force?: boolean;
    signal?: AbortSignal;
    onProgress?: (written: number) => void;
};
export type DeleteResult = { deleted: RemoteBmp[]; error?: string };

type FileError = ApplicationError | ServerError;

const KNOWN_SERVER_ERRORS: readonly ServerError[] = Object.values(SERVER_ERRORS);

function saveFailure(path: string): ApplicationError {
    return { code: 'DOWNLOAD_SAVE_FAILED', message: `Could not save ${path}.` };
}

function fileRequest(
    item: FileGroup,
    action: FileActionKind,
    token: string,
    workers: number
): Result<FileRequest, ApplicationError> {
    return schemaResult(
        FileRequestSchema,
        {
            action,
            email: item.email,
            token,
            name: item.name,
            fileHash: item.fileHash,
            fileId: item.fileId,
            chunks: item.chunks,
            workers
        },
        'Invalid file metadata.'
    );
}

/** The download stream fails with the server's own error values, which keep their messages. */
function streamFailure(reason: unknown): ServerError {
    return (
        KNOWN_SERVER_ERRORS.find((error) => error === reason) ??
        SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE
    );
}

function ensureAvailable(path: string, force: boolean): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (force) return Ok(undefined);

        try {
            await lstat(path);
        } catch (error) {
            const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

            return missing ? Ok(undefined) : Err(saveFailure(path));
        }

        return Err({ code: 'FILE_EXISTS', message: `${path} already exists.` } as const);
    });
}

function copyBody(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    handle: FileHandle,
    path: string,
    onProgress?: (written: number) => void
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync<void, FileError>(async () => {
        let written = 0;

        while (true) {
            let next: ReadableStreamReadResult<Uint8Array>;

            try {
                next = await reader.read();
            } catch (reason) {
                return Err(streamFailure(reason));
            }
            if (next.done) return Ok(undefined);

            try {
                await handle.write(next.value);
            } catch {
                return Err(saveFailure(path));
            }

            written += next.value.byteLength;
            onProgress?.(written);
        }
    });
}

function writeBody(
    body: ReadableStream<Uint8Array>,
    path: string,
    onProgress?: (written: number) => void
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync(async () => {
        let handle: FileHandle;

        try {
            handle = await open(path, 'wx');
        } catch {
            return Err(saveFailure(path));
        }

        const reader = body.getReader();
        const copied = await copyBody(reader, handle, path, onProgress);

        await reader.cancel().catch(() => {});
        reader.releaseLock();

        try {
            await handle.close();
        } catch {
            return copied.andThen(() => Err(saveFailure(path)));
        }

        return copied;
    });
}

function moveIntoPlace(
    temporary: string,
    destination: string,
    force: boolean
): AsyncResult<void, ApplicationError> {
    return ensureAvailable(destination, force).andThenAsync(async () => {
        try {
            await rename(temporary, destination);

            return Ok(undefined);
        } catch {
            return Err(saveFailure(destination));
        }
    });
}

/** Stream a verified file into a hidden sibling, then move it into place only when complete. */
export function downloadFile(
    item: FileGroup,
    token: string,
    destination: string,
    { force = false, signal, onProgress }: DownloadOptions = {}
): AsyncResult<void, FileError> {
    return Ok(undefined).andThenAsync<void, FileError>(async () => {
        if (!item.complete)
            return Err({
                code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
                message: `${item.name} is missing chunks and cannot be downloaded.`
            } as const);

        const available = await ensureAvailable(destination, force);
        if (available.isErr()) return available;

        const temporary = join(
            dirname(destination),
            `.${basename(destination)}.${randomUUID()}.part`
        );
        const saved = await fileRequest(item, FileActionKind.Download, token, 1)
            .andThenAsync((input) => downloadRemoteFile(input, signal))
            .andThenAsync(async (response) => {
                if (!response.body) return Err(SERVER_ERRORS.MISSING_DOWNLOAD_BODY);

                return await writeBody(response.body, temporary, onProgress);
            })
            .andThenAsync(() => moveIntoPlace(temporary, destination, force));

        if (saved.isErr()) await rm(temporary, { force: true }).catch(() => {});

        return saved;
    });
}

/** Move every chunk to the trash; confirmed removals are returned even after a partial failure. */
export function deleteFile(
    item: FileGroup,
    token: string,
    workers: number
): AsyncResult<DeleteResult, FileError> {
    return validateWorkers(workers)
        .andThen((concurrency) => fileRequest(item, FileActionKind.Delete, token, concurrency))
        .andThenAsync((input) => deleteRemoteFile(input));
}
