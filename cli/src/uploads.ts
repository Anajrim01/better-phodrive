import { resolve } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { openLocalFiles, uploadFiles, type UploadJob } from '@madkarmaa/phodrive-core/node';
import type { Session } from './accounts';
import type { CliContext, CliError } from './context';
import { status, transferProgress } from './output';

export function openUploads(
    context: CliContext,
    paths: readonly string[]
): AsyncResult<File[], CliError> {
    return openLocalFiles(paths.map((path) => resolve(context.cwd, path))).andThen(
        (local): Result<File[], CliError> => {
            if (!local.length)
                return Err({ code: 'NO_FILES_SELECTED', message: 'No files to upload.' } as const);

            return Ok(local.map(({ file }) => file));
        }
    );
}

function finished(job: UploadJob): boolean {
    return job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error;
}

/** Bytes of the original file accounted for, so files of every size weigh fairly. */
function jobBytes(job: UploadJob, size: number): number {
    if (job.status === UploadJobStatus.Complete) return size;
    if (job.progress.phase !== UploadPhase.Uploading || !job.progress.total) return 0;

    const { completed, reused, total } = job.progress;

    return Math.floor(((completed + reused) / total) * size);
}

function reportJob(context: CliContext, job: UploadJob): void {
    if (job.status === UploadJobStatus.Error) {
        status(context).error(`${job.name}: ${job.message}`);

        return;
    }
    if (job.result?.status === UploadStatus.AlreadyExists) {
        status(context).success(`${job.name} was already in Google Photos`);

        return;
    }

    status(context).success(`Uploaded ${job.name}`);
}

/** Show combined progress; scripts get a line as each file finishes, the terminal a summary. */
function trackUploads(
    context: CliContext,
    files: readonly File[],
    bar: ReturnType<typeof transferProgress>
) {
    const jobs = new Map<number, UploadJob>();

    const onJob = (job: UploadJob) => {
        const previous = jobs.get(job.id);
        jobs.set(job.id, job);

        const newlyFinished = finished(job) && !(previous && finished(previous));
        if (!context.interactive && newlyFinished) reportJob(context, job);

        const current = [...jobs.values()];
        const done = current.filter(finished).length;
        const sent = current.reduce(
            (sum, item) => sum + jobBytes(item, files[item.id]?.size ?? 0),
            0
        );
        bar.update(sent, `${done} of ${files.length} files`);
    };
    const results = () => [...jobs.values()].sort((first, second) => first.id - second.id);

    return { onJob, results };
}

export function sendFiles(
    context: CliContext,
    session: Session,
    files: readonly File[],
    workers: number
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const total = files.reduce((sum, file) => sum + file.size, 0);
        const bar = transferProgress(
            context,
            `Uploading ${files.length} files (${prettyBytes(total)})`,
            total
        );
        const tracker = trackUploads(context, files, bar);

        const uploaded = await uploadFiles(
            files,
            session.email,
            session.token,
            workers,
            tracker.onJob,
            () => {},
            { signal: context.signal }
        );

        const results = tracker.results();
        const failed = results.filter((job) => job.status !== UploadJobStatus.Complete).length;
        if (uploaded.isErr() || failed) bar.fail();
        else bar.stop(`Uploaded ${files.length} files to ${session.email}`);

        if (context.interactive) for (const job of results) reportJob(context, job);
        if (uploaded.isErr()) return uploaded;
        if (!failed) return Ok(undefined);

        return Err({
            code: 'UPLOAD_INCOMPLETE',
            message: `${failed} of ${files.length} files failed to upload.`
        } as const);
    });
}
