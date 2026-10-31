import { resolve } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { addFolderAlbums } from '@madkarmaa/phodrive-core/albums';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import {
    openLocalFiles,
    uploadFiles,
    type LocalFile,
    type UploadJob
} from '@madkarmaa/phodrive-core/node';
import { assignFolderAlbum } from '@madkarmaa/phodrive-core/server/photos';
import type { Session } from './accounts';
import { updateConfig } from './config';
import type { CliContext, CliError } from './context';
import { status, transferProgress } from './output';
import { throttleMessage } from './throttle';

export function openUploads(
    context: CliContext,
    paths: readonly string[]
): AsyncResult<LocalFile[], CliError> {
    return openLocalFiles(paths.map((path) => resolve(context.cwd, path))).andThen(
        (local): Result<LocalFile[], CliError> => {
            if (!local.length)
                return Err({ code: 'NO_FILES_SELECTED', message: 'No files to upload.' } as const);

            return Ok(local);
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

export function reportJob(context: CliContext, job: UploadJob): void {
    if (job.status === UploadJobStatus.Error) {
        status(context).error(`${job.name}: ${job.message}`);

        return;
    }
    if (job.status === UploadJobStatus.Queued) {
        status(context).warn(`${job.name}: ${job.message || 'Waiting for an available account.'}`);

        return;
    }
    if (job.result?.status === UploadStatus.AlreadyExists) {
        status(context).success(`${job.name} was already in Google Photos`);

        return;
    }

    status(context).success(`Uploaded ${job.name}`);
}

export function trackUploads(
    context: CliContext,
    files: readonly LocalFile[],
    bar: ReturnType<typeof transferProgress>
) {
    const jobs = new Map<number, UploadJob>();
    const paused = new Map<number, number>();

    const onJob = (job: UploadJob) => {
        const previous = jobs.get(job.id);
        jobs.set(job.id, job);

        if (job.retryAt !== null) {
            if (paused.get(job.id) !== job.retryAt) {
                paused.set(job.id, job.retryAt);
                const seconds = Math.max(1, Math.ceil((job.retryAt - Date.now()) / 1_000));
                status(context).warn(`${job.name}: ${throttleMessage(seconds)}`);
            }
        } else {
            paused.delete(job.id);
        }

        const newlyFinished = finished(job) && !(previous && finished(previous));
        if (!context.interactive && newlyFinished) reportJob(context, job);

        const current = [...jobs.values()];
        const done = current.filter(finished).length;
        const sent = current.reduce(
            (sum, item) => sum + jobBytes(item, files[item.id]?.file.size ?? 0),
            0
        );
        bar.update(sent, `${done} of ${files.length} files`);
    };

    return {
        onJob,
        results: () => [...jobs.values()].sort((first, second) => first.id - second.id)
    };
}

export async function mirrorAlbums(
    context: CliContext,
    session: Session,
    chunks: readonly UploadedChunk[]
): Promise<void> {
    if (!chunks.length) return;

    const keys = new Map<string, string>();

    await addFolderAlbums(
        chunks,
        (folder) => session.config.albums[session.email]?.[folder],
        (folder, key) => {
            keys.set(folder, key);
        },
        (folder, key, mediaKeys) =>
            assignFolderAlbum(session.email, session.token, folder, key, mediaKeys),
        (folder, message) => {
            status(context).warn(`${folder}: ${message}`);
        }
    );

    if (!keys.size) return;

    const saved = await updateConfig(context.configPath, (config) =>
        Ok({
            ...config,
            albums: {
                ...config.albums,
                [session.email]: { ...config.albums[session.email], ...Object.fromEntries(keys) }
            }
        })
    );
    saved.inspectErr((error) => {
        status(context).warn(error.message);
    });
}

export function sendFiles(
    context: CliContext,
    session: Session,
    files: readonly LocalFile[],
    workers: number,
    compress = false
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const total = files.reduce((sum, { file }) => sum + file.size, 0);
        const bar = transferProgress(
            context,
            `Uploading ${files.length} files (${prettyBytes(total)})`,
            total
        );
        const tracker = trackUploads(context, files, bar);
        const chunks: UploadedChunk[] = [];
        const folders = new Map(files.map(({ file, folder }) => [file, folder]));

        const uploaded = await uploadFiles(
            files.map(({ file }) => file),
            session.email,
            session.token,
            workers,
            tracker.onJob,
            (chunk) => {
                chunks.push(chunk);
            },
            { signal: context.signal, folders, compress }
        );

        const results = tracker.results();
        const failed = results.filter((job) => job.status !== UploadJobStatus.Complete).length;
        if (uploaded.isErr() || failed) bar.fail();
        else bar.stop(`Uploaded ${files.length} files to ${session.email}`);

        if (context.interactive) for (const job of results) reportJob(context, job);

        await mirrorAlbums(context, session, chunks);

        if (uploaded.isErr()) return uploaded;
        if (!failed) return Ok(undefined);

        return Err({
            code: 'UPLOAD_INCOMPLETE',
            message: `${failed} of ${files.length} files failed to upload.`
        } as const);
    });
}
