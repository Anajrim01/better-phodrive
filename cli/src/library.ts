import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { readLibrary } from '@madkarmaa/phodrive-core/node';
import { readConfig, type CliConfig } from './config';
import type { CliContext, CliError } from './context';
import { activity, formatBytes, fileSize, shortId } from './output';
import { askChoice } from './prompts';

export type Session = { email: string; token: string; config: CliConfig };

const ID_PREFIX_PATTERN = /^[a-f0-9]{4,64}$/;

/** Email addresses match regardless of case, returning the address as it was saved. */
export function findAccount(config: CliConfig, email: string): string | undefined {
    const wanted = email.trim().toLowerCase();

    return Object.keys(config.accounts).find((saved) => saved.toLowerCase() === wanted);
}

/** The chosen account, falling back to the saved selection and then the first account. */
export function selectedEmail(config: CliConfig): string {
    if (Object.hasOwn(config.accounts, config.selected)) return config.selected;

    return Object.keys(config.accounts)[0] ?? '';
}

export function openSession(context: CliContext, account?: string): AsyncResult<Session, CliError> {
    return readConfig(context.configPath).andThen((config): Result<Session, CliError> => {
        const requested = account?.trim() || selectedEmail(config);
        if (!requested)
            return Err({
                code: 'ACCOUNT_REQUIRED',
                message: 'No account is connected. Run `phodrive account add` first.'
            } as const);

        const email = findAccount(config, requested);
        const token = email && config.accounts[email];
        if (!email || !token)
            return Err({
                code: 'ACCOUNT_NOT_FOUND',
                message: `${requested} is not connected. Run \`phodrive account list\` to see accounts.`
            } as const);

        return Ok({ email, token, config });
    });
}

export function loadFiles(
    context: CliContext,
    session: Session
): AsyncResult<FileGroup[], CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const indicator = activity(context, `Loading files for ${session.email}`);

        const files = await readLibrary(session.email, session.token);

        files.match({
            Ok: (found) => indicator.stop(`Found ${found.length} files`),
            Err: () => indicator.fail()
        });

        return files;
    });
}

function describe(file: FileGroup): string {
    return `${file.name} (${shortId(file)})`;
}

/** A target is a file ID prefix or an exact file name. */
function matchTarget(files: readonly FileGroup[], target: string): FileGroup[] {
    const prefix = target.toLowerCase();
    const byId = ID_PREFIX_PATTERN.test(prefix);

    return files.filter((file) => file.name === target || (byId && file.fileId.startsWith(prefix)));
}

function resolveTarget(
    context: CliContext,
    files: readonly FileGroup[],
    target: string
): AsyncResult<FileGroup, CliError> {
    return Ok(undefined)
        .andThenAsync<FileGroup, CliError>(async () => {
            const matches = matchTarget(files, target);
            const [only] = matches;
            if (!only)
                return Err({
                    code: 'FILE_NOT_FOUND',
                    message: `No file matches ${target}. Run \`phodrive file list\` to see files.`
                } as const);
            if (matches.length === 1) return Ok(only);

            const ambiguous = `${target} matches ${matches.length} files: ${matches.map(describe).join(', ')}. Use a file ID instead.`;
            const chosen = await askChoice(
                context,
                `${target} matches ${matches.length} files. Which one?`,
                ambiguous,
                matches.map((file) => ({
                    value: file.fileId,
                    label: describe(file),
                    hint: `${formatBytes(fileSize(file))}, ${new Date(file.at).toLocaleString()}`
                }))
            );

            return chosen.map((fileId) => matches.find((file) => file.fileId === fileId) ?? only);
        })
        .mapErr((error): CliError =>
            error.code === 'INPUT_REQUIRED'
                ? { code: 'AMBIGUOUS_FILE', message: error.message }
                : error
        );
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
