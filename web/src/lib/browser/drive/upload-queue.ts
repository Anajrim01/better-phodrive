import type { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';
import { uploadBatch } from './actions';
import type { DriveLibrary } from './library.svelte';
import type { UploadQueue } from './upload-plan';

type QueueRun = {
    queue: UploadQueue;
    workers: number;
    processing: ProcessingMode;
    library: DriveLibrary;
    retryId?: number;
    signal: AbortSignal;
    onJob: (job: UploadJob, id: number) => void;
    onError: (message: string, jobIds: readonly number[]) => void;
};

export async function runUploadQueue({
    queue,
    workers,
    processing,
    library,
    retryId,
    signal,
    onJob,
    onError
}: QueueRun): Promise<void> {
    const uploaded = await uploadBatch({
        files: queue.files,
        account: queue.account,
        workers,
        processing,
        library,
        jobIds: queue.jobIds,
        folders: queue.folders,
        retryId,
        signal,
        onJob
    });

    uploaded.inspectErr((error) => onError(error.message, queue.jobIds));
}
