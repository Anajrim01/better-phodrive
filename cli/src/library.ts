import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { deleteFile, readLibrary, type DeleteResult } from '@madkarmaa/phodrive-core/node';
import type { Session } from './accounts';
import type { CliContext, CliError } from './context';
import { activity, fileSize, shortId, status } from './output';
import { askChoice } from './prompts';
import { retryThrottled } from './throttle';

const ID_PREFIX_PATTERN = /^[a-f0-9]{4,64}$/;

export function loadFiles(
    context: CliContext,
    session: Session
): AsyncResult<FileGroup[], CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const indicator = activity(context, `Loading files for ${session.email}`);

        const files = await retryThrottled(context, () =>
            readLibrary(session.email, session.token)
        );

        files.match({
            Ok: (found) => indicator.stop(`Found ${found.length} files`),
            Err: () => indicator.fail()
        });

        return files;
    });
}

export function filePath(file: FileGroup): string {
    return file.folder ? `${file.folder}/${file.name}` : file.name;
}

function describe(file: FileGroup): string {
    return `${filePath(file)} (${shortId(file)})`;
}

/** A target is a file ID prefix or an exact file name. */
function matchTarget(files: readonly FileGroup[], target: string): FileGroup[] {
    const prefix = target.toLowerCase();
    const byId = ID_PREFIX_PATTERN.test(prefix);

    return files.filter(
        (file) =>
            file.name === target ||
            filePath(file) === target ||
            (byId && file.fileId.startsWith(prefix))
    );
}

/** At a terminal the person picks one match; scripts are told to use an ID instead. */
function chooseMatch(
    context: CliContext,
    target: string,
    matches: readonly FileGroup[]
): AsyncResult<FileGroup, CliError> {
    const listed = matches.map(describe).join(', ');
    const hint = `${target} matches ${matches.length} files: ${listed}. Use a file ID instead.`;
    const choices = matches.map((file) => ({
        value: file.fileId,
        label: describe(file),
        hint: `${prettyBytes(fileSize(file))}, ${new Date(file.at).toLocaleString()}`
    }));

    return askChoice(
        context,
        `${target} matches ${matches.length} files. Which one?`,
        hint,
        choices
    )
        .mapErr((error): CliError =>
            error.code === 'INPUT_REQUIRED'
                ? { code: 'AMBIGUOUS_FILE', message: error.message }
                : error
        )
        .map((fileId) => matches.find((file) => file.fileId === fileId) ?? matches[0]);
}

function resolveTarget(
    context: CliContext,
    files: readonly FileGroup[],
    target: string
): AsyncResult<FileGroup, CliError> {
    return Ok(undefined).andThenAsync<FileGroup, CliError>(async () => {
        const matches = matchTarget(files, target);
        const [only] = matches;
        if (!only)
            return Err({
                code: 'FILE_NOT_FOUND',
                message: `No file matches ${target}. Run \`phodrive file list\` to see files.`
            } as const);
        if (matches.length === 1) return Ok(only);

        return await chooseMatch(context, target, matches);
    });
}

/** Resolve each target once, keeping the order given and skipping repeated files. */
export function resolveTargets(
    context: CliContext,
    files: readonly FileGroup[],
    targets: readonly string[]
): AsyncResult<FileGroup[], CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const resolved = new Map<string, FileGroup>();

        for (const target of targets) {
            const file = await resolveTarget(context, files, target);
            if (file.isErr()) return file;

            file.inspect((found) => resolved.set(found.fileId, found));
        }

        return Ok([...resolved.values()]);
    });
}

/** Load the library and resolve file names or IDs given on the command line. */
export function findFiles(
    context: CliContext,
    session: Session,
    targets: readonly string[]
): AsyncResult<FileGroup[], CliError> {
    return loadFiles(context, session).andThenAsync((files) =>
        resolveTargets(context, files, targets)
    );
}

/** A file is deleted only when every known chunk is confirmed in the trash. */
function deleteFailure(file: FileGroup, { deleted, error }: DeleteResult): string | null {
    if (!error && deleted.length === file.chunks.length) return null;

    const reason = error ? ` ${error}` : '';

    return `${file.name}: deleted ${deleted.length} of ${file.chunks.length} chunks.${reason}`;
}

export function deleteFiles(
    context: CliContext,
    session: Session,
    files: readonly FileGroup[],
    workers: number
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        let failed = 0;

        for (const file of files) {
            const deleted = await retryThrottled(context, () =>
                deleteFile(file, session.token, workers)
            );

            const failure = deleted.match({
                Ok: (result) => deleteFailure(file, result),
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
