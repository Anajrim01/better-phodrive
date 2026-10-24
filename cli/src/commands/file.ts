import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { filterFiles, sortFiles, type FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    UploadJobStatus,
    UploadPhase,
    UploadStatus,
    type FileSort
} from '@madkarmaa/phodrive-core/models';
import {
    deleteFile,
    downloadFile,
    openLocalFiles,
    uploadFiles,
    type UploadJob
} from '@madkarmaa/phodrive-core/node';
import type { CliContext, CliError } from '../context';
import { loadFiles, openSession, resolveTargets, type Session } from '../library';
import {
    FILE_TABLE_HEAD,
    fileJson,
    fileRow,
    fileSize,
    formatBytes,
    printJson,
    printTable,
    status,
    transferProgress
} from '../output';
import { askConfirmation, canConfirm } from '../prompts';
import type { Runner } from '../program';
import { concurrentWorkers, fileSort, parseSort, parseWorkers } from '../settings';

const DAYS_PATTERN = /^[1-9]\d*$/;
const UNSAFE_NAMES = new Set(['.', '..']);

type ListOptions = { type?: string; days?: string; sort?: string; json?: boolean };

function chooseWorkers(context: CliContext, session: Session, raw?: string) {
    if (raw === undefined) return Ok(concurrentWorkers(session.config, context.environment));

    return parseWorkers(raw);
}

function parseDays(raw?: string): Result<string, CliError> {
    if (raw === undefined || DAYS_PATTERN.test(raw.trim())) return Ok(raw?.trim() ?? '');

    return Err({
        code: 'INVALID_OPTION',
        message: 'Invalid days. Use a whole number of days greater than 0.'
    } as const);
}

function sortOrder(context: CliContext, session: Session, raw?: string) {
    if (raw === undefined) return Ok(fileSort(session.config, context.environment));

    return parseSort(raw);
}

function showFiles(
    context: CliContext,
    files: readonly FileGroup[],
    filters: { query: string; type: string; days: string; order: FileSort },
    json = false
): void {
    const shown = sortFiles(
        filterFiles(files, filters.query, filters.type, filters.days),
        filters.order
    );

    if (json) {
        printJson(context, shown.map(fileJson));

        return;
    }
    if (!shown.length) {
        status(context).info('No files found.');

        return;
    }

    printTable(context, FILE_TABLE_HEAD, shown.map(fileRow));
}

function listFiles(
    context: CliContext,
    query: string | undefined,
    options: ListOptions,
    account?: string
): AsyncResult<void, CliError> {
    return openSession(context, account).andThenAsync((session) =>
        parseDays(options.days)
            .andThen((days) =>
                sortOrder(context, session, options.sort).map((order) => ({
                    query: query ?? '',
                    type: options.type?.trim().toUpperCase() ?? '',
                    days,
                    order
                }))
            )
            .andThenAsync((filters) =>
                loadFiles(context, session).map((files) =>
                    showFiles(context, files, filters, options.json)
                )
            )
    );
}

function jobBytes(job: UploadJob, size: number): number {
    if (job.status === UploadJobStatus.Complete) return size;
    if (job.progress.phase !== UploadPhase.Uploading || !job.progress.total) return 0;

    const { completed, reused, total } = job.progress;

    return Math.floor(((completed + reused) / total) * size);
}

function finished(job: UploadJob): boolean {
    return job.status === UploadJobStatus.Complete || job.status === UploadJobStatus.Error;
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

function openUploads(context: CliContext, paths: readonly string[]): AsyncResult<File[], CliError> {
    return openLocalFiles(paths.map((path) => resolve(context.cwd, path))).andThen(
        (local): Result<File[], CliError> => {
            if (!local.length)
                return Err({ code: 'NO_FILES_SELECTED', message: 'No files to upload.' } as const);

            return Ok(local.map(({ file }) => file));
        }
    );
}

function sendFiles(
    context: CliContext,
    session: Session,
    files: readonly File[],
    workers: number
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync<void, CliError>(async () => {
        const total = files.reduce((sum, file) => sum + file.size, 0);
        const bar = transferProgress(
            context,
            `Uploading ${files.length} files (${formatBytes(total)})`,
            total
        );
        const jobs = new Map<number, UploadJob>();
        const onJob = (job: UploadJob) => {
            const previous = jobs.get(job.id);
            jobs.set(job.id, job);

            // Scripts receive a line as each file finishes; the terminal shows a summary.
            if (!context.interactive && finished(job) && !(previous && finished(previous)))
                reportJob(context, job);

            const current = [...jobs.values()];
            const done = current.filter(finished).length;
            const sent = current.reduce(
                (sum, item) => sum + jobBytes(item, files[item.id]?.size ?? 0),
                0
            );
            bar.update(sent, `${done} of ${files.length} files`);
        };

        const uploaded = await uploadFiles(
            files,
            session.email,
            session.token,
            workers,
            onJob,
            () => {},
            { signal: context.signal }
        );

        const results = [...jobs.values()].sort((first, second) => first.id - second.id);
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

function upload(
    context: CliContext,
    paths: readonly string[],
    workersOption?: string,
    account?: string
): AsyncResult<void, CliError> {
    return openSession(context, account).andThenAsync((session) =>
        chooseWorkers(context, session, workersOption).andThenAsync((workers) =>
            openUploads(context, paths).andThenAsync((files) =>
                sendFiles(context, session, files, workers)
            )
        )
    );
}

function inspectFolder(path: string): AsyncResult<boolean | null, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const stats = await stat(path);

            return Ok(stats.isDirectory());
        } catch (error) {
            const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
            if (missing) return Ok(null);

            return Err({ code: 'INVALID_OPTION', message: `Could not read ${path}.` } as const);
        }
    });
}

function createFolder(path: string): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await mkdir(path, { recursive: true });

            return Ok(undefined);
        } catch {
            return Err({ code: 'INVALID_OPTION', message: `Could not create ${path}.` } as const);
        }
    });
}

type PlannedDownload = { file: FileGroup; destination: string };

/** Several files, a trailing separator, or an existing folder all mean a destination folder. */
function planDownloads(
    context: CliContext,
    files: readonly FileGroup[],
    output?: string
): AsyncResult<PlannedDownload[], CliError> {
    const target = resolve(context.cwd, output ?? '.');
    const wantsFolder = files.length > 1 || output === undefined || /[\\/]$/.test(output);

    return inspectFolder(target).andThenAsync<PlannedDownload[], CliError>(async (existing) => {
        if (existing === false && files.length > 1)
            return Err({
                code: 'INVALID_OPTION',
                message: '--output must be a folder when downloading several files.'
            } as const);

        if (existing === true || (existing === null && wantsFolder)) {
            const unsafe = files.find((file) => UNSAFE_NAMES.has(file.name));
            if (unsafe)
                return Err({
                    code: 'INVALID_OPTION',
                    message: `${unsafe.name} cannot be saved under its own name. Pass --output with a file path.`
                } as const);

            const created = await createFolder(target);

            return created.map(() =>
                files.map((file) => ({ file, destination: join(target, file.name) }))
            );
        }

        const parent = await createFolder(dirname(target));

        return parent.map(() => files.map((file) => ({ file, destination: target })));
    });
}

function saveFiles(
    context: CliContext,
    session: Session,
    planned: readonly PlannedDownload[],
    force: boolean
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const failures: CliError[] = [];

        for (const { file, destination } of planned) {
            if (context.signal.aborted) break;

            const size = fileSize(file);
            const bar = transferProgress(context, `Downloading ${file.name}`, size);

            const saved = await downloadFile(file, session.token, destination, {
                force,
                signal: context.signal,
                onProgress: (written) =>
                    bar.update(written, `${formatBytes(written)} of ${formatBytes(size)}`)
            });

            saved.match({
                Ok: () => {
                    bar.stop(`Downloaded ${file.name}`);
                    status(context).success(`Saved ${destination}`);
                },
                Err: (error) => {
                    bar.fail();
                    const hint = error.code === 'FILE_EXISTS' ? ' Pass --force to replace it.' : '';
                    status(context).error(`${file.name}: ${error.message}${hint}`);
                    failures.push(error);
                }
            });
        }

        const [failure] = failures;
        if (!failure) return Ok(undefined);
        if (planned.length === 1) return Err(failure);

        return Err({
            code: 'DOWNLOAD_INCOMPLETE',
            message: `${failures.length} of ${planned.length} files failed to download.`
        } as const);
    });
}

function download(
    context: CliContext,
    targets: readonly string[],
    options: { output?: string; force?: boolean },
    account?: string
): AsyncResult<void, CliError> {
    return openSession(context, account).andThenAsync((session) =>
        loadFiles(context, session)
            .andThenAsync((files) => resolveTargets(context, files, targets))
            .andThenAsync((selected) => planDownloads(context, selected, options.output))
            .andThenAsync((planned) => saveFiles(context, session, planned, options.force ?? false))
    );
}

/** A file is deleted only when every known chunk is confirmed in the trash. */
function deleteFiles(
    context: CliContext,
    session: Session,
    files: readonly FileGroup[],
    workers: number
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        let failed = 0;

        for (const file of files) {
            const deleted = await deleteFile(file, session.token, workers);

            const failure = deleted.match({
                Ok: ({ deleted: chunks, error }) => {
                    if (!error && chunks.length === file.chunks.length) return null;

                    const reason = error ? ` ${error}` : '';

                    return `${file.name}: deleted ${chunks.length} of ${file.chunks.length} chunks.${reason}`;
                },
                Err: (error) => `${file.name}: ${error.message}`
            });
            if (failure) {
                failed++;
                status(context).error(failure);

                continue;
            }

            status(context).success(`Deleted ${file.name}`);
        }

        if (!failed) return Ok(undefined);

        return Err({
            code: 'DELETE_INCOMPLETE',
            message: `${failed} of ${files.length} files were not fully deleted. Run the command again to retry.`
        } as const);
    });
}

function remove(
    context: CliContext,
    targets: readonly string[],
    options: { yes?: boolean; workers?: string },
    account?: string
): AsyncResult<void, CliError> {
    // Fail before reading the library when no confirmation is possible.
    const confirmable = canConfirm(context, 'Deleting files needs confirmation.', options.yes);

    return confirmable
        .andThenAsync(() => openSession(context, account))
        .andThenAsync((session) =>
            chooseWorkers(context, session, options.workers).andThenAsync((workers) =>
                loadFiles(context, session)
                    .andThenAsync((files) => resolveTargets(context, files, targets))
                    .andThenAsync((selected) =>
                        askConfirmation(
                            context,
                            `Delete ${selected.map((file) => file.name).join(', ')} from ${session.email}?`,
                            options.yes
                        ).map(() => selected)
                    )
                    .andThenAsync((selected) => deleteFiles(context, session, selected, workers))
            )
        );
}

export function registerFileCommands(program: Command, context: CliContext, run: Runner) {
    const file = program.command('file').description('List, upload, download, and delete files');

    file.command('list')
        .description('List files, newest first by default')
        .argument('[search]', 'show names containing this text')
        .option('--type <extension>', 'show one file type, for example pdf')
        .option('--days <days>', 'show files modified in the last number of days')
        .option('--sort <order>', 'modified-desc, modified-asc, name-asc, or name-desc')
        .option('--json', 'print JSON')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((search, options) =>
            run(() => listFiles(context, search, options, options.account))
        );

    file.command('upload')
        .description('Upload files, and every file inside folders')
        .argument('<paths...>', 'files or folders')
        .option('-w, --workers <count>', 'concurrent transfers')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((paths, options) =>
            run(() => upload(context, paths, options.workers, options.account))
        );

    file.command('download')
        .description('Download files by name or ID')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-o, --output <path>', 'destination folder, or file path for one file')
        .option('-f, --force', 'replace existing local files')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((targets, options) =>
            run(() => download(context, targets, options, options.account))
        );

    file.command('delete')
        .description('Move files to the Google Photos trash')
        .argument('<files...>', 'file names or IDs from `phodrive file list`')
        .option('-y, --yes', 'skip the confirmation')
        .option('-w, --workers <count>', 'concurrent requests')
        .option('-a, --account <email>', 'use this account instead of the active one')
        .action((targets, options) =>
            run(() => remove(context, targets, options, options.account))
        );
}
