import pLimit from 'p-limit';
import { Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { folderFromFile } from '../../files';
import type { GroupMember } from '../../groups';
import { assignOwners } from '../../groups';
import {
    ConcurrentWorkersSchema,
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadJobStatus,
    UploadPhase
} from '../../models';
import { planChunks } from '../../upload';
import { schemaResult } from '../../validation';
import type { UploadOptions } from './index';
import { uploadPlannedFile } from './file';
import { hashFile, uploadIdentity } from './hash';
import { createUploadEventHandler, createUploadJobs, type UploadJob } from './jobs';
import { httpChunkTransport, type ChunkTransport } from './request';

const PROGRESS_INTERVAL_MS = 100;

export type GroupUploadMember = GroupMember & { token: string };

export type GroupUploadResult = {
    waiting: number;
};

type Source = { file: File; index: number };

function reportWaiting(jobs: UploadJob[], index: number, onJob: (job: UploadJob) => void): void {
    const job = {
        ...jobs[index],
        status: UploadJobStatus.Queued,
        message: 'Waiting for an available account.'
    };
    jobs[index] = job;
    onJob(job);
}

export function uploadGroupFiles(
    files: readonly File[],
    members: readonly GroupUploadMember[],
    workers: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void,
    options: UploadOptions = {}
): AsyncResult<GroupUploadResult, ApplicationError> {
    return schemaResult(
        ConcurrentWorkersSchema,
        workers,
        'Invalid concurrent worker count.'
    ).andThenAsync((concurrency) =>
        transferGroupFiles(files, members, concurrency, onJob, onChunk, httpChunkTransport, options)
    );
}

/** Assign one owner per file, then give each account its own transfer pools and breaker. */
export function transferGroupFiles(
    files: readonly File[],
    members: readonly GroupUploadMember[],
    concurrency: number,
    onJob: (job: UploadJob) => void,
    onChunk: (chunk: UploadedChunk) => void,
    transport: ChunkTransport,
    options: UploadOptions = {}
): AsyncResult<GroupUploadResult, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const jobs = createUploadJobs(files);
        const sources: Source[] = [];

        for (const [index, file] of files.entries()) {
            const valid =
                FileNameSchema.safeParse(file.name).success &&
                FileSizeSchema.safeParse(file.size).success;
            if (!valid) {
                jobs[index] = {
                    ...jobs[index],
                    status: UploadJobStatus.Error,
                    message: 'Invalid file name or size.'
                };
                onJob(jobs[index]);
                continue;
            }

            sources.push({ file, index });
        }
        if (!sources.length) return Ok({ waiting: 0 });

        const assignments = assignOwners(
            sources.map(({ file, index }) => ({
                fileId: String(index),
                name: file.name,
                size: file.size
            })),
            members
        );
        const ownerBySource = new Map(assignments.map(({ fileId, owner }) => [fileId, owner]));
        const byAccount = new Map<string, Source[]>();

        for (const source of sources) {
            const owner = ownerBySource.get(String(source.index));
            if (!owner) continue;

            const current = byAccount.get(owner);
            if (current) current.push(source);
            else byAccount.set(owner, [source]);
        }

        await Promise.all(
            [...byAccount.entries()].map(async ([owner, accountSources]) => {
                const member = members.find(
                    (candidate) => candidate.email.toLowerCase() === owner.toLowerCase()
                );
                if (!member) return;

                let paused = false;
                const chunkLimit = pLimit(concurrency);
                const fileLimit = pLimit(concurrency);

                await fileLimit.map(accountSources, async ({ file, index }) => {
                    if (paused) return;

                    const eventSources: { file: File; jobId: number }[] = [];
                    eventSources[index] = { file, jobId: index };
                    const handle = createUploadEventHandler(
                        eventSources,
                        jobs,
                        member.email,
                        (job) => {
                            if (job.retryAt !== null) paused = true;
                            onJob(job);
                        },
                        onChunk
                    );
                    handle({ type: UploadEventType.Queued, id: index });

                    const folder =
                        options.folders?.get(file) ?? folderFromFile(file, options.folder);
                    let lastProgress = 0;
                    const prepared = await hashFile(file, (completed) => {
                        const now = performance.now();
                        if (completed !== file.size && now - lastProgress < PROGRESS_INTERVAL_MS)
                            return;

                        lastProgress = now;
                        handle({
                            type: UploadEventType.Progress,
                            id: index,
                            progress: {
                                phase: UploadPhase.Preparing,
                                completed,
                                total: file.size
                            }
                        });
                    }).andThenAsync((fileHash) =>
                        uploadIdentity(file.name, fileHash, folder).map((fileId) => ({
                            fileHash,
                            fileId
                        }))
                    );
                    if (prepared.isErr()) {
                        prepared.inspectErr((error) =>
                            handle({
                                type: UploadEventType.FileError,
                                id: index,
                                error: error.message
                            })
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
                            handle({
                                type: UploadEventType.FileError,
                                id: index,
                                error: error.message
                            })
                        );

                        return;
                    }

                    await planned.andThenAsync((plan) =>
                        uploadPlannedFile(
                            { file, id: index },
                            plan,
                            { email: member.email, token: member.token },
                            transport,
                            chunkLimit,
                            handle,
                            options.compress === true
                        )
                    );
                });
            })
        );

        const waitingSources = sources.filter(
            ({ index }) => jobs[index].status === UploadJobStatus.Queued
        );
        for (const { index } of waitingSources) reportWaiting(jobs, index, onJob);

        return Ok({ waiting: waitingSources.length });
    });
}
