import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { UploadJobStatus, type Group } from '@madkarmaa/phodrive-core/models';
import { uploadGroupFiles, type LocalFile } from '@madkarmaa/phodrive-core/node';
import type { CliConfig } from './config';
import type { CliContext, CliError } from './context';
import { groupUploadAccounts, type GroupAccount } from './groups';
import { transferProgress } from './output';
import { mirrorAlbums, reportJob, trackUploads } from './uploads';

export function sendGroupFiles(
    context: CliContext,
    config: CliConfig,
    group: Group,
    files: readonly LocalFile[],
    workers: number,
    compress = false
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const accounts = groupUploadAccounts(config, group);
        if (accounts.isErr()) return accounts;

        const members = accounts.unwrap();
        const total = files.reduce((sum, { file }) => sum + file.size, 0);
        const bar = transferProgress(
            context,
            `Uploading ${files.length} files across ${members.length} accounts (${prettyBytes(total)})`,
            total
        );
        const tracker = trackUploads(context, files, bar);
        const chunks: UploadedChunk[] = [];
        const folders = new Map(files.map(({ file, folder }) => [file, folder]));

        const uploaded = await uploadGroupFiles(
            files.map(({ file }) => file),
            members,
            workers,
            tracker.onJob,
            (chunk) => {
                chunks.push(chunk);
            },
            { signal: context.signal, folders, compress }
        );

        const results = tracker.results();
        const waiting = results.filter((job) => job.status === UploadJobStatus.Queued).length;
        const failed = results.filter(
            (job) =>
                job.status !== UploadJobStatus.Complete && job.status !== UploadJobStatus.Queued
        ).length;
        if (uploaded.isErr() || failed || waiting) bar.fail();
        else bar.stop(`Uploaded ${files.length} files across ${members.length} accounts`);

        if (context.interactive) for (const job of results) reportJob(context, job);
        else
            for (const job of results.filter((job) => job.status === UploadJobStatus.Queued))
                reportJob(context, job);

        for (const member of members) await mirrorOwnerAlbums(context, config, member, chunks);

        if (uploaded.isErr()) return uploaded;
        if (failed || waiting) {
            const parts: string[] = [];
            if (failed) parts.push(`${failed} of ${files.length} files failed to upload.`);
            if (waiting)
                parts.push(
                    `${waiting} of ${files.length} files were not uploaded because no account was available.`
                );

            return Err({ code: 'UPLOAD_INCOMPLETE', message: parts.join(' ') } as const);
        }

        return Ok(undefined);
    });
}

async function mirrorOwnerAlbums(
    context: CliContext,
    config: CliConfig,
    member: GroupAccount,
    chunks: readonly UploadedChunk[]
): Promise<void> {
    const owned = chunks.filter(
        (chunk) => chunk.email.toLowerCase() === member.email.toLowerCase()
    );
    if (!owned.length) return;

    await mirrorAlbums(context, { email: member.email, token: member.token, config }, owned);
}
