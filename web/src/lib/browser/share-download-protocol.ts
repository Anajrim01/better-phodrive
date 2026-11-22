import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';

export const SHARE_DOWNLOAD_TEMP_PREFIX = 'phodrive-share-';

export type ShareDownloadTarget =
    | { readonly kind: 'automatic' }
    | { readonly kind: 'picker'; readonly handle: FileSystemFileHandle }
    | { readonly kind: 'cancelled' };

export type ShareDownloadOutcome =
    | { readonly kind: 'saved' }
    | {
          readonly kind: 'file';
          readonly file: File;
          readonly release: () => AsyncResult<void, ApplicationError>;
      };

export interface ShareDownloadSyncAccessHandle {
    write(buffer: BufferSource, options?: { readonly at?: number }): number;
    flush(): void;
    close(): void;
}

export interface ShareDownloadWritable {
    write(data: BufferSource): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
}

export interface ShareDownloadFileHandle {
    getFile(): Promise<File>;
    createSyncAccessHandle(): Promise<ShareDownloadSyncAccessHandle>;
    createWritable(): Promise<ShareDownloadWritable>;
}

export interface ShareDownloadDirectory {
    getFileHandle(
        name: string,
        options?: { readonly create?: boolean }
    ): Promise<ShareDownloadFileHandle>;
    removeEntry(name: string, options?: { readonly recursive?: boolean }): Promise<void>;
}

export interface ShareDownloadStorage {
    getDirectory(): Promise<ShareDownloadDirectory>;
}

export interface ShareDownloadWorker {
    open(file: ShareFile, target: ShareDownloadTarget): AsyncResult<void, ApplicationError>;
    append(bytes: Uint8Array<ArrayBuffer>): AsyncResult<void, ApplicationError>;
    finish(): AsyncResult<ShareDownloadOutcome, ApplicationError>;
    abort(): AsyncResult<void, ApplicationError>;
}

export type ShareDownloadWorkerRequest =
    | {
          readonly kind: 'open';
          readonly file: ShareFile;
          readonly name: string;
          readonly handle?: ShareDownloadFileHandle;
      }
    | { readonly kind: 'append'; readonly bytes: Uint8Array<ArrayBuffer> }
    | { readonly kind: 'finish' }
    | { readonly kind: 'abort' };

export type ShareDownloadWorkerReply =
    | { readonly kind: 'opened' }
    | { readonly kind: 'appended' }
    | { readonly kind: 'finished'; readonly handle?: ShareDownloadFileHandle }
    | { readonly kind: 'aborted' }
    | { readonly kind: 'failed'; readonly error: ApplicationError };
