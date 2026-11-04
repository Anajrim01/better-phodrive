import {
    FileNameSchema,
    FileSizeSchema,
    FolderPathSchema,
    UploadJobStatus,
    type GoogleAccountSummary
} from '@madkarmaa/phodrive-core/models';
import { folderFromFile } from '@madkarmaa/phodrive-core/files';
import { assignUploadOwners } from '@madkarmaa/phodrive-core/browser/upload';
import { createUploadJobs, type UploadJob } from '#browser/files';
import type { DriveContext } from '#browser/drive/context.svelte';
import { replaceJob } from '#browser/drive/chunks';

export type UploadQueue = {
    account: GoogleAccountSummary;
    files: File[];
    jobIds: number[];
    folders: string[];
};

export type UploadPlan = {
    jobs: UploadJob[];
    owners: Map<number, GoogleAccountSummary>;
    folders: Map<number, string>;
    queues: UploadQueue[];
};

/** Assign each valid file to one account and resolve its folder before any bytes are sent. */
export function planUploads(
    files: readonly File[],
    context: DriveContext,
    rootFolder = ''
): UploadPlan {
    let jobs = createUploadJobs(files);
    const sources: { file: File; jobId: number; folder: string }[] = [];

    for (const [jobId, file] of files.entries()) {
        const valid =
            FileNameSchema.safeParse(file.name).success &&
            FileSizeSchema.safeParse(file.size).success;
        if (!valid) {
            jobs = replaceJob(jobs, jobId, {
                ...jobs[jobId]!,
                status: UploadJobStatus.Error,
                message: 'Invalid file name or size.',
                retryable: false
            });
            continue;
        }

        const folder = folderFromFile(file, rootFolder);
        if (folder && !FolderPathSchema.safeParse(folder).success) {
            jobs = replaceJob(jobs, jobId, {
                ...jobs[jobId]!,
                status: UploadJobStatus.Error,
                message: 'Invalid folder path.',
                retryable: false
            });
            continue;
        }

        sources.push({ file, jobId, folder });
    }

    const members = context.kind === 'account' ? [context.account] : context.group.members;
    if (!sources.length || !members.length)
        return { jobs, owners: new Map(), folders: new Map(), queues: [] };

    const assignments =
        context.kind === 'account'
            ? sources.map(({ jobId }) => ({ jobId, accountId: context.account.id }))
            : assignUploadOwners(
                  sources.map(({ file, jobId }) => ({
                      jobId,
                      name: file.name,
                      size: file.size
                  })),
                  members
              );
    const accounts = new Map(members.map((account) => [account.id, account]));
    const sourcesByJob = new Map(sources.map((source) => [source.jobId, source]));
    const owners = new Map<number, GoogleAccountSummary>();
    const folders = new Map<number, string>();
    const queues = new Map<string, UploadQueue>();

    for (const assignment of assignments) {
        const account = accounts.get(assignment.accountId!)!;
        const source = sourcesByJob.get(assignment.jobId)!;

        owners.set(source.jobId, account);
        folders.set(source.jobId, source.folder);
        const queue = queues.get(account.id) ?? {
            account,
            files: [],
            jobIds: [],
            folders: []
        };
        queue.files.push(source.file);
        queue.jobIds.push(source.jobId);
        queue.folders.push(source.folder);
        queues.set(account.id, queue);
    }

    return { jobs, owners, folders, queues: [...queues.values()] };
}
