import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { openSession, type Session } from './accounts';
import { readConfig } from './config';
import type { CliContext, CliError } from './context';
import { planDownloads, saveFiles, saveGroupFiles } from './downloads';
import { reportGroupState } from './file-list';
import { findGroup, readGroupLibrary } from './groups';
import { deleteFiles, deleteGroupFiles, filePath, findFiles, resolveTargets } from './library';
import { askConfirmation, canConfirm } from './prompts';
import { chooseCompression, chooseWorkers } from './settings';
import { sendGroupFiles } from './group-uploads';
import { openUploads, sendFiles } from './uploads';

function invalidGroupOptions(): AsyncResult<void, CliError> {
    return Err({
        code: 'INVALID_OPTION',
        message: 'Use either --group or --account, not both.'
    } as const).andThenAsync(async () => Ok(undefined));
}

export function upload(
    context: CliContext,
    paths: readonly string[],
    options: { workers?: string; account?: string; compress?: boolean; group?: string }
): AsyncResult<void, CliError> {
    if (options.group && options.account) return invalidGroupOptions();

    if (options.group)
        return readConfig(context.configPath).andThenAsync(async (config) => {
            const group = findGroup(config, options.group!);
            if (group.isErr()) return group;

            const workers = chooseWorkers(config, context.environment, options.workers);
            if (workers.isErr()) return workers;

            const files = await openUploads(context, paths);
            if (files.isErr()) return files;

            return await sendGroupFiles(
                context,
                config,
                group.unwrap(),
                files.unwrap(),
                workers.unwrap(),
                chooseCompression(config, options.compress)
            );
        });

    return openSession(context, options.account).andThenAsync((session) =>
        chooseWorkers(session.config, context.environment, options.workers).andThenAsync(
            (workers) =>
                openUploads(context, paths).andThenAsync((files) =>
                    sendFiles(
                        context,
                        session,
                        files,
                        workers,
                        chooseCompression(session.config, options.compress)
                    )
                )
        )
    );
}

export function download(
    context: CliContext,
    targets: readonly string[],
    options: { output?: string; force?: boolean; account?: string; group?: string }
): AsyncResult<void, CliError> {
    if (options.group && options.account) return invalidGroupOptions();

    if (options.group)
        return readConfig(context.configPath).andThenAsync(async (config) => {
            const group = findGroup(config, options.group!);
            if (group.isErr()) return group;

            const library = await readGroupLibrary(config, group.unwrap());
            if (library.isErr()) return library;

            reportGroupState(context, library.unwrap());

            const files = await resolveTargets(context, library.unwrap().files, targets);
            if (files.isErr()) return files;

            const planned = await planDownloads(context, files.unwrap(), options.output);
            if (planned.isErr()) return planned;

            return await saveGroupFiles(
                context,
                planned.unwrap(),
                library.unwrap().members,
                options.force ?? false
            );
        });

    return openSession(context, options.account).andThenAsync((session) =>
        findFiles(context, session, targets)
            .andThenAsync((files) => planDownloads(context, files, options.output))
            .andThenAsync((planned) => saveFiles(context, session, planned, options.force ?? false))
    );
}

function confirmDeletion(
    context: CliContext,
    session: Session,
    files: readonly FileGroup[],
    confirmed?: boolean
): AsyncResult<void, CliError> {
    const names = files.map(filePath).join(', ');

    return askConfirmation(context, `Delete ${names} from ${session.email}?`, confirmed);
}

export function remove(
    context: CliContext,
    targets: readonly string[],
    options: {
        yes?: boolean;
        workers?: string;
        account?: string;
        group?: string;
    }
): AsyncResult<void, CliError> {
    // Fail before reading the library when no confirmation is possible.
    const confirmable = canConfirm(context, 'Deleting files needs confirmation.', options.yes);

    if (options.group && options.account) return invalidGroupOptions();

    if (options.group)
        return confirmable
            .andThenAsync(() => readConfig(context.configPath))
            .andThenAsync(async (config) => {
                const group = findGroup(config, options.group!);
                if (group.isErr()) return group;

                const workers = chooseWorkers(config, context.environment, options.workers);
                if (workers.isErr()) return workers;

                const library = await readGroupLibrary(config, group.unwrap());
                if (library.isErr()) return library;
                reportGroupState(context, library.unwrap());

                const files = await resolveTargets(context, library.unwrap().files, targets);
                if (files.isErr()) return files;

                const names = files.unwrap().map(filePath).join(', ');
                const confirmed = await askConfirmation(
                    context,
                    `Delete ${names} from their owners?`,
                    options.yes
                );
                if (confirmed.isErr()) return confirmed;

                return await deleteGroupFiles(
                    context,
                    files.unwrap(),
                    library.unwrap().members,
                    workers.unwrap()
                );
            });

    return confirmable
        .andThenAsync(() => openSession(context, options.account))
        .andThenAsync((session) =>
            chooseWorkers(session.config, context.environment, options.workers).andThenAsync(
                (workers) =>
                    findFiles(context, session, targets)
                        .andThenAsync((files) =>
                            confirmDeletion(context, session, files, options.yes).map(() => files)
                        )
                        .andThenAsync((files) => deleteFiles(context, session, files, workers))
            )
        );
}
