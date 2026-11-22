import { dirname, join, resolve } from 'node:path';
import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { downloadFile } from '@madkarmaa/phodrive-core/node';
import type { Session } from './accounts';
import type { CliContext, CliError } from './context';
import { createFolder, inspectFolder } from './filesystem';
import { fileSize, status, transferProgress } from './output';

const UNSAFE_NAMES = new Set(['.', '..']);

type PlannedDownload = { file: FileGroup; destination: string };

function intoFolder(
    files: readonly FileGroup[],
    folder: string
): AsyncResult<PlannedDownload[], CliError> {
    return Ok(undefined).andThenAsync<PlannedDownload[], CliError>(async () => {
        const unsafe = files.find((file) => UNSAFE_NAMES.has(file.name));
        if (unsafe)
            return Err({
                code: 'INVALID_OPTION',
                message: `${unsafe.name} cannot be saved under its own name. Pass --output with a file path.`
            } as const);

        const created = await createFolder(folder);

        return created.map(() =>
            files.map((file) => ({ file, destination: join(folder, file.name) }))
        );
    });
}

/** Several files, a trailing separator, or an existing folder all mean a destination folder. */
export function planDownloads(
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
        if (existing === true || (existing === null && wantsFolder))
            return await intoFolder(files, target);

        const parent = await createFolder(dirname(target));

        return parent.map(() => files.map((file) => ({ file, destination: target })));
    });
}

export function saveFiles(
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
                    bar.update(written, `${prettyBytes(written)} of ${prettyBytes(size)}`)
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
