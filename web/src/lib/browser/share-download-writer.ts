import { INTEGRITY_FAILED } from '@madkarmaa/phodrive-core/browser/chunk-verifier';
import {
    acquireHasher,
    createSHA256,
    digestHasher,
    updateHasher
} from '@madkarmaa/phodrive-core/browser/hashers';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type {
    ShareDownloadDirectory,
    ShareDownloadFileHandle,
    ShareDownloadOutcome,
    ShareDownloadStorage,
    ShareDownloadSyncAccessHandle,
    ShareDownloadWritable
} from './share-download-protocol';

const STORAGE_UNAVAILABLE = {
    code: 'STORAGE_UNAVAILABLE',
    message: 'This browser cannot store the download.'
} as const satisfies ApplicationError;
const SAVE_FAILED = {
    code: 'DOWNLOAD_SAVE_FAILED',
    message: 'Could not save the downloaded file.'
} as const satisfies ApplicationError;

export type ShareDownloadCompletion =
    | { readonly kind: 'saved' }
    | { readonly kind: 'handle'; readonly handle: ShareDownloadFileHandle };

export type ShareDownloadSink = {
    write(bytes: Uint8Array<ArrayBuffer>, offset: number): AsyncResult<void, ApplicationError>;
    close(): AsyncResult<void, ApplicationError>;
    discard(): AsyncResult<void, ApplicationError>;
    completion(): ShareDownloadCompletion;
};

function writableSink(
    handle: ShareDownloadFileHandle
): AsyncResult<ShareDownloadSink, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let writable: ShareDownloadWritable;

        try {
            writable = await handle.createWritable();
        } catch {
            return Err(SAVE_FAILED);
        }

        return Ok({
            write: (bytes) =>
                Ok(undefined).andThenAsync(async () => {
                    try {
                        await writable.write(bytes);

                        return Ok(undefined);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            close: () =>
                Ok(undefined).andThenAsync(async () => {
                    try {
                        await writable.close();

                        return Ok(undefined);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            discard: () =>
                Ok(undefined).andThenAsync(async () => {
                    try {
                        await writable.abort();

                        return Ok(undefined);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            completion: () => ({ kind: 'saved' })
        } satisfies ShareDownloadSink);
    });
}

function opfsSink(
    name: string,
    storage: ShareDownloadStorage | undefined
): AsyncResult<ShareDownloadSink, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!storage) return Err(STORAGE_UNAVAILABLE);

        let directory: ShareDownloadDirectory;
        let handle: ShareDownloadFileHandle;

        try {
            directory = await storage.getDirectory();
            handle = await directory.getFileHandle(name, { create: true });
        } catch {
            return Err(STORAGE_UNAVAILABLE);
        }

        let access: ShareDownloadSyncAccessHandle;

        try {
            access = await handle.createSyncAccessHandle();
        } catch {
            await directory.removeEntry(name).catch(() => {});

            return Err(STORAGE_UNAVAILABLE);
        }

        let closed = false;

        return Ok({
            write: (bytes, offset) =>
                Ok(undefined).andThenAsync(async () => {
                    if (closed) return Err(SAVE_FAILED);

                    try {
                        const written = access.write(bytes, { at: offset });

                        return written === bytes.byteLength ? Ok(undefined) : Err(SAVE_FAILED);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            close: () =>
                Ok(undefined).andThenAsync(async () => {
                    if (closed) return Ok(undefined);

                    try {
                        access.flush();
                        access.close();
                        closed = true;

                        return Ok(undefined);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            discard: () =>
                Ok(undefined).andThenAsync(async () => {
                    if (!closed) {
                        try {
                            access.close();
                        } catch {}

                        closed = true;
                    }

                    try {
                        await directory.removeEntry(name);

                        return Ok(undefined);
                    } catch {
                        return Err(SAVE_FAILED);
                    }
                }),
            completion: () => ({ kind: 'handle', handle })
        } satisfies ShareDownloadSink);
    });
}

export function createShareDownloadSink(
    handle: ShareDownloadFileHandle | null,
    name: string,
    storage: ShareDownloadStorage | undefined = globalThis.navigator?.storage
): AsyncResult<ShareDownloadSink, ApplicationError> {
    return handle ? writableSink(handle) : opfsSink(name, storage);
}

export class ShareDownloadWriter {
    private written = 0;
    private closed = false;

    private constructor(
        private readonly file: ShareFile,
        private readonly hasher: Parameters<typeof updateHasher>[0],
        private readonly sink: ShareDownloadSink
    ) {}

    static start(
        file: ShareFile,
        sink: ShareDownloadSink
    ): AsyncResult<ShareDownloadWriter, ApplicationError> {
        return acquireHasher(createSHA256).map(
            (hasher) => new ShareDownloadWriter(file, hasher, sink)
        );
    }

    append(bytes: Uint8Array<ArrayBuffer>): AsyncResult<void, ApplicationError> {
        return Ok(undefined).andThenAsync<void, ApplicationError>(async () => {
            if (this.closed || this.written + bytes.byteLength > this.file.size)
                return Err(INTEGRITY_FAILED);

            const hashed = updateHasher(this.hasher, bytes);
            if (hashed.isErr()) return hashed;

            const written = await this.sink.write(bytes, this.written);
            if (written.isErr()) return written;

            this.written += bytes.byteLength;

            return Ok(undefined);
        });
    }

    finish(): AsyncResult<ShareDownloadCompletion, ApplicationError> {
        return Ok(undefined)
            .andThen(() => (this.closed ? Err(INTEGRITY_FAILED) : Ok(undefined)))
            .andThen(() =>
                this.written === this.file.size ? Ok(undefined) : Err(INTEGRITY_FAILED)
            )
            .andThen(() => digestHasher(this.hasher))
            .andThen((digest) =>
                digest === this.file.fileHash ? Ok(undefined) : Err(INTEGRITY_FAILED)
            )
            .andThenAsync(() => this.sink.close())
            .map(() => {
                this.closed = true;

                return this.sink.completion();
            })
            .orElseAsync(async (failure) => {
                if (!this.closed) {
                    this.closed = true;
                    await this.sink.discard();
                }

                return Err(failure);
            });
    }

    abort(): AsyncResult<void, ApplicationError> {
        this.closed = true;

        return this.sink.discard();
    }
}
