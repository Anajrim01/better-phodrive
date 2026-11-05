import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { GoogleAccountSummary, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import type { AsyncResult } from 'results-ts';
import {
    deleteFile,
    deleteForeverFile as deleteForeverRemoteFile,
    downloadFile,
    restoreFile as restoreRemoteFile,
    saveDownloadedFile,
    uploadFiles,
    type UploadJob
} from '#browser/files';
import { holdUploadedChunks } from '#browser/drive/chunks';
import type { DriveLibrary } from '#browser/drive/library.svelte';

/** Move a file's chunks to the trash, marking each once Google confirms it. */
export function trashFile(
    library: DriveLibrary,
    item: FileGroup
): AsyncResult<void, ApplicationError> {
    return deleteFile(item, (chunk) => {
        library.markChunkTrashed(item, chunk);
    });
}

/** Restore a trashed file in place, without changing its identity or folder. */
export function restoreFile(
    library: DriveLibrary,
    item: FileGroup
): AsyncResult<void, ApplicationError> {
    return restoreRemoteFile(item, (chunk) => {
        library.markChunkRestored(item, chunk);
    });
}

/** Permanently delete a trashed file and drop its confirmed chunks from the library. */
export function deleteForeverFile(
    library: DriveLibrary,
    item: FileGroup
): AsyncResult<void, ApplicationError> {
    return deleteForeverRemoteFile(item, (chunk) => {
        library.removeChunk(item, chunk);
    });
}

export function downloadAndSave(
    item: FileGroup,
    processing: ProcessingMode
): AsyncResult<void, ApplicationError> {
    return downloadFile(item, processing).andThen((file) => saveDownloadedFile(file, item.name));
}

export interface UploadBatch {
    files: readonly File[];
    account: GoogleAccountSummary;
    workers: number;
    processing: ProcessingMode;
    library: DriveLibrary;
    /** Global job IDs for this queue, in the same order as `files`. */
    jobIds?: readonly number[];
    /** Resolved folder for each queue file, in the same order. */
    folders?: readonly string[];
    /** A retry reports its single file under the job ID it already has. */
    retryId?: number;
    signal?: AbortSignal;
    onJob: (job: UploadJob, id: number) => void;
}

/** Upload files to one account, adding each file's confirmed chunks to the library once it ends. */
export function uploadBatch({
    files,
    account,
    workers,
    processing,
    library,
    jobIds,
    folders,
    retryId,
    signal,
    onJob
}: UploadBatch): AsyncResult<void, ApplicationError> {
    const uploadedChunks = holdUploadedChunks((saved) => {
        library.appendChunks(saved);
    });

    return uploadFiles(
        files,
        account.email,
        workers,
        (job) => {
            onJob(job, retryId ?? jobIds?.[job.id] ?? job.id);
            uploadedChunks.settle(job);
        },
        uploadedChunks.hold,
        processing,
        account.id,
        signal,
        folders
    )
        .inspect(uploadedChunks.releaseAll)
        .inspectErr(uploadedChunks.releaseAll);
}
