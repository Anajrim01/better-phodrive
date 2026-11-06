import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    SHARE_DOWNLOAD_TEMP_PREFIX,
    type ShareDownloadFileHandle,
    type ShareDownloadOutcome,
    type ShareDownloadStorage,
    type ShareDownloadTarget,
    type ShareDownloadWorker,
    type ShareDownloadWorkerReply,
    type ShareDownloadWorkerRequest
} from './share-download-protocol';

const SAVE_FAILED = {
    code: 'DOWNLOAD_SAVE_FAILED',
    message: 'Could not save the downloaded file.'
} as const satisfies ApplicationError;
const WORKER_FAILED = {
    code: 'DOWNLOAD_SAVE_FAILED',
    message: 'Could not start the download helper.'
} as const satisfies ApplicationError;

const STALE_TEMPORARY_MS = 24 * 60 * 60_000;

// Another tab may be writing or saving an entry: a write holds it locked, and the age covers a save.
export async function removeStaleShareDownloads(now = Date.now()): Promise<void> {
    try {
        const directory = await globalThis.navigator.storage.getDirectory();
        const names: string[] = [];
        for await (const name of directory.keys())
            if (name.startsWith(SHARE_DOWNLOAD_TEMP_PREFIX)) names.push(name);

        for (const name of names) {
            try {
                const handle = await directory.getFileHandle(name);
                const { lastModified } = await handle.getFile();
                if (now - lastModified >= STALE_TEMPORARY_MS) await directory.removeEntry(name);
            } catch {
                continue;
            }
        }
    } catch {
        return;
    }
}

function removeTemporary(name: string): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const storage: ShareDownloadStorage | undefined = globalThis.navigator?.storage;
        if (!storage) return Err(SAVE_FAILED);

        try {
            const directory = await storage.getDirectory();
            await directory.removeEntry(name);

            return Ok(undefined);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'NotFoundError')
                return Ok(undefined);

            return Err(SAVE_FAILED);
        }
    });
}

function fileOutcome(
    handle: ShareDownloadFileHandle,
    name: string
): AsyncResult<ShareDownloadOutcome, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let file: File;

        try {
            file = await handle.getFile();
        } catch {
            await removeTemporary(name);

            return Err(SAVE_FAILED);
        }

        return Ok({
            kind: 'file',
            file,
            release: () => removeTemporary(name)
        } as const);
    });
}

class ShareDownloadWorkerClient implements ShareDownloadWorker {
    private pending: ((reply: Result<ShareDownloadWorkerReply, ApplicationError>) => void) | null =
        null;
    private alive = true;
    private readonly name = `${SHARE_DOWNLOAD_TEMP_PREFIX}${crypto.randomUUID()}`;

    constructor(private readonly worker: Worker) {
        worker.addEventListener('message', (event: MessageEvent<ShareDownloadWorkerReply>) => {
            this.settle(Ok(event.data));
        });
        worker.addEventListener('error', () => {
            this.shutdown();
            this.settle(Err(WORKER_FAILED));
        });
        worker.addEventListener('messageerror', () => {
            this.shutdown();
            this.settle(Err(WORKER_FAILED));
        });
    }

    open(file: ShareFile, target: ShareDownloadTarget): AsyncResult<void, ApplicationError> {
        const handle = target.kind === 'picker' ? target.handle : undefined;
        const metadata = { ...file };
        const request: ShareDownloadWorkerRequest = handle
            ? { kind: 'open', file: metadata, name: this.name, handle }
            : { kind: 'open', file: metadata, name: this.name };

        return this.request(request).map(() => undefined);
    }

    append(bytes: Uint8Array<ArrayBuffer>): AsyncResult<void, ApplicationError> {
        return this.request({ kind: 'append', bytes }).map(() => undefined);
    }

    finish(): AsyncResult<ShareDownloadOutcome, ApplicationError> {
        return this.request({ kind: 'finish' }).andThenAsync(async (reply) => {
            if (reply.kind !== 'finished') {
                this.shutdown();

                return Err(WORKER_FAILED);
            }

            if (!reply.handle) {
                this.shutdown();

                return Ok({ kind: 'saved' } as const);
            }

            const outcome = await fileOutcome(reply.handle, this.name);
            this.shutdown();

            return outcome;
        });
    }

    abort(): AsyncResult<void, ApplicationError> {
        if (!this.alive) return removeTemporary(this.name);

        return this.request({ kind: 'abort' })
            .map(() => {
                this.shutdown();
            })
            .orElse((error) => {
                this.shutdown();

                return Err(error);
            });
    }

    private shutdown(): void {
        this.alive = false;
        this.worker.terminate();
    }

    private settle(reply: Result<ShareDownloadWorkerReply, ApplicationError>): void {
        const pending = this.pending;
        this.pending = null;
        pending?.(reply);
    }

    private request(
        message: ShareDownloadWorkerRequest
    ): AsyncResult<ShareDownloadWorkerReply, ApplicationError> {
        return this.exchange(message).andThen((reply) =>
            reply.kind === 'failed' ? Err(reply.error) : Ok(reply)
        );
    }

    private exchange(
        message: ShareDownloadWorkerRequest
    ): AsyncResult<ShareDownloadWorkerReply, ApplicationError> {
        return Ok(undefined).andThenAsync(
            () =>
                new Promise((resolve) => {
                    if (!this.alive) {
                        resolve(Err(WORKER_FAILED));

                        return;
                    }
                    this.pending = resolve;

                    try {
                        this.worker.postMessage(message);
                    } catch {
                        this.pending = null;
                        resolve(Err(WORKER_FAILED));
                    }
                })
        );
    }
}

export function createShareDownloadWorker(): AsyncResult<ShareDownloadWorker, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        await removeStaleShareDownloads();

        try {
            const worker = new Worker(new URL('./share-download-worker.ts', import.meta.url), {
                type: 'module'
            });

            return Ok(new ShareDownloadWorkerClient(worker));
        } catch {
            return Err(WORKER_FAILED);
        }
    });
}
