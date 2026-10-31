import { childFolders, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { FolderPathSchema } from '@madkarmaa/phodrive-core/models';
import { Err, Ok, type Result } from 'results-ts';
import type { CliContext, CliError } from './context';
import { FOLDER_TABLE_HEAD, printJson, printTable, status } from './output';

export function parseFolder(option?: string): Result<string | undefined, CliError> {
    if (option === undefined) return Ok(undefined);

    const trimmed = option.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed || trimmed === '.') return Ok('');

    const parsed = FolderPathSchema.safeParse(trimmed);
    if (parsed.success) return Ok(parsed.data);

    return Err({
        code: 'INVALID_OPTION',
        message: `Invalid folder path ${option}.`
    } as const);
}

function folderEntries(files: readonly FileGroup[], folder: string | undefined) {
    if (folder !== undefined) return childFolders(files, folder);

    const entries: ReturnType<typeof childFolders> = [];
    const pending = [''];

    while (pending.length) {
        const current = pending.shift() ?? '';
        for (const child of childFolders(files, current)) {
            entries.push(child);
            pending.push(child.path);
        }
    }

    return entries.sort((first, second) => first.path.localeCompare(second.path));
}

export function showFolders(
    context: CliContext,
    files: readonly FileGroup[],
    folder: string | undefined,
    json = false
): void {
    const entries = folderEntries(files, folder);

    if (json) {
        printJson(
            context,
            entries.map((entry) => ({
                folder: entry.path,
                files: entry.files,
                subfolders: entry.subfolders
            }))
        );

        return;
    }
    if (!entries.length) {
        status(context).info('No folders found.');

        return;
    }

    printTable(
        context,
        FOLDER_TABLE_HEAD,
        entries.map((entry) => [entry.path, String(entry.files), String(entry.subfolders)])
    );
}
