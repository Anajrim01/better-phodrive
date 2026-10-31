import pLimit from 'p-limit';
import { Ok, type AsyncResult } from 'results-ts';
import {
    ConcurrentWorkersSchema,
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadPhase,
    UploadJobStatus
} from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { folderFromFile } from '../../files';
import { schemaResult } from '../../validation';
import { planChunks } from '../../upload';
import { httpChunkTransport, type ChunkTransport } from './request';
import { hashFile, uploadIdentity } from './hash';
import { createUploadJobs, createUploadEventHandler, type UploadJob } from './jobs';
import { uploadPlannedFile } from './file';

const PROGRESS_INTERVAL_MS = 100;

export type UploadOptions = {
    folder?: string;
    folders?: ReadonlyMap<File, string>;
    compress?: boolean;
};

export function uploadFiles(
    files: readonly File[],
    email: string,
    token: string,
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void,
    options: UploadOptions = {}
): AsyncResult<void, ApplicationError> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync((concurrency) =>
        transferFiles(files, email, token, concurrency, onJob, onChunk, httpChunkTransport, options)
    );
}

/** The shared pool behind every uploader; callers validate the worker count for their runtime. */
export function transferFiles(
    files: readonly File[],
    email: string,
    token: string,
    concurrency: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void,
    transport: ChunkTransport,
    options: UploadOptions = {}
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const jobs = createUploadJobs(files);
        const sources: { file: File; jobId: number }[] = [];
        for (const [id, file] of files.entries()) {
            const valid =
                FileNameSchema.safeParse(file.name).success &&
                FileSizeSchema.safeParse(file.size).success;
            if (!valid) {
                jobs[id] = {
                    ...jobs[id],
                    status: UploadJobStatus.Error,
                    message: 'Invalid file name or size.'
                };
                onJob(jobs[id]);
                continue;
            }

            sources.push({ file, jobId: id });
        }
        if (!sources.length) return Ok(undefined);

        const handle = createUploadEventHandler(sources, jobs, email, onJob, onChunk);
        const chunkLimit = pLimit(concurrency);
        const fileLimit = pLimit(concurrency);
        await fileLimit.map(sources, async ({ file }, id) => {
            handle({ type: UploadEventType.Queued, id });

            const folder = options.folders?.get(file) ?? folderFromFile(file, options.folder);
            let lastProgress = 0;
            const prepared = await hashFile(file, (completed) => {
                const now = performance.now();
                if (completed !== file.size && now - lastProgress < PROGRESS_INTERVAL_MS) return;

                lastProgress = now;
                handle({
                    type: UploadEventType.Progress,
                    id,
                    progress: { phase: UploadPhase.Preparing, completed, total: file.size }
                });
            }).andThenAsync((fileHash) =>
                uploadIdentity(file.name, fileHash, folder).map((fileId) => ({
                    fileHash,
                    fileId
                }))
            );
            if (prepared.isErr()) {
                prepared.inspectErr((error) =>
                    handle({ type: UploadEventType.FileError, id, error: error.message })
                );

                return;
            }

            const planned = prepared.andThen(({ fileHash, fileId }) =>
                planChunks(
                    {
                        name: file.name,
                        folder: folder || undefined,
                        size: file.size,
                        fileHash
                    },
                    fileId
                )
            );

            if (planned.isErr()) {
                planned.inspectErr((error) =>
                    handle({ type: UploadEventType.FileError, id, error: error.message })
                );

                return;
            }

            await planned.andThenAsync((plan) =>
                uploadPlannedFile(
                    { file, id },
                    plan,
                    { email, token },
                    transport,
                    chunkLimit,
                    handle,
                    options.compress === true
                )
            );
        });

        return handle({ type: UploadEventType.Complete });
    });
}
