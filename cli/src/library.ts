import prettyBytes from 'pretty-bytes';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { deleteRoute, type RouteMember } from '@madkarmaa/phodrive-core/groups';
import { deleteFile, readLibrary, type DeleteResult } from '@madkarmaa/phodrive-core/node';
import type { Session } from './accounts';
import type { CliContext, CliError } from './context';
import { activity, fileSize, shortId, status } from './output';
import { askChoice } from './prompts';
import { flushProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { retryThrottled, THROTTLE_RETRY_LIMIT, throttleMessage, waitForThrottle } from './throttle';

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
        files.inspect(() => flushProbeCache());

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
    const total = file.chunks.length + file.duplicates.length;
    if (deleted.length === total) return null;

    const reason = error ? ` ${error}` : '';

    return `${file.name}: deleted ${deleted.length} of ${total} chunks.${reason}`;
}

function deletePlanned(
    context: CliContext,
    files: readonly FileGroup[],
    workers: number,
    tokenForFile: (file: FileGroup) => Result<string, CliError>
): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        let failed = 0;

        for (const file of files) {
            const routed = tokenForFile(file);
            if (routed.isErr()) {
                failed++;
                status(context).error(`${file.name}: ${routed.unwrapErr().message}`);

                continue;
            }
            const token = routed.unwrap();

            let remaining = [...file.chunks, ...file.duplicates];
            const deleted: DeleteResult['deleted'] = [];
            let error: string | undefined;
            let lastThrottle: number | undefined;

            for (let attempt = 1; attempt <= THROTTLE_RETRY_LIMIT; attempt++) {
                const result = await deleteFile({ ...file, chunks: remaining }, token, workers);
                if (result.isErr()) {
                    error = result.unwrapErr().message;
                    lastThrottle = undefined;

                    break;
                }

                const current = result.unwrap();
                deleted.push(...current.deleted);
                error = current.error;
                lastThrottle = current.retryAfterSeconds;

                const removed = new Set(
                    current.deleted.map((chunk) => `${chunk.mediaKey}\u0000${chunk.sha1}`)
                );
                remaining = remaining.filter(
                    (chunk) => !removed.has(`${chunk.mediaKey}\u0000${chunk.sha1}`)
                );

                if (
                    !current.retryAfterSeconds ||
                    remaining.length === 0 ||
                    attempt === THROTTLE_RETRY_LIMIT
                )
                    break;

                await waitForThrottle(context, current.retryAfterSeconds);
            }

            if (remaining.length && lastThrottle !== undefined)
                error = throttleMessage(lastThrottle, 'try again');

            const failure = deleteFailure(file, { deleted, error });
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

export function deleteFiles(
    context: CliContext,
    session: Session,
    files: readonly FileGroup[],
    workers: number
): AsyncResult<void, CliError> {
    return deletePlanned(context, files, workers, () => Ok(session.token));
}

export function deleteGroupFiles(
    context: CliContext,
    files: readonly FileGroup[],
    members: readonly RouteMember[],
    workers: number
): AsyncResult<void, CliError> {
    return deletePlanned(context, files, workers, (file) =>
        deleteRoute(file, members).map((route) => route.token)
    );
}
