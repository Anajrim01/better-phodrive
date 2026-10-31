import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { filterFiles, sortFiles, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { FileSort } from '@madkarmaa/phodrive-core/models';
import { openSession } from './accounts';
import { readConfig, type CliConfig } from './config';
import type { CliContext, CliError } from './context';
import { parseFolder, showFolders } from './folders';
import { findGroup, readGroupLibrary, type GroupLibraryView } from './groups';
import { loadFiles } from './library';
import {
    FILE_TABLE_HEAD,
    GROUP_FILE_TABLE_HEAD,
    fileJson,
    fileRow,
    jsonContext,
    printJson,
    printTable,
    status
} from './output';
import { chooseSort } from './settings';

const DAYS_PATTERN = /^[1-9]\d*$/;

export type ListOptions = {
    type?: string;
    days?: string;
    sort?: string;
    folder?: string;
    folders?: boolean;
    json?: boolean;
    account?: string;
    group?: string;
};

type Filters = {
    query: string;
    type: string;
    days: string;
    order: FileSort;
    folder?: string;
};

function parseDays(option?: string): Result<string, CliError> {
    if (option === undefined) return Ok('');

    const days = option.trim();
    if (DAYS_PATTERN.test(days)) return Ok(days);

    return Err({
        code: 'INVALID_OPTION',
        message: 'Invalid days. Use a whole number of days greater than 0.'
    } as const);
}

function parseFilters(
    context: CliContext,
    config: CliConfig,
    query: string | undefined,
    options: ListOptions
): Result<Filters, CliError> {
    return parseDays(options.days)
        .andThen((days) =>
            chooseSort(config, context.environment, options.sort).map((order) => ({
                query: query ?? '',
                type: options.type?.trim().toUpperCase() ?? '',
                days,
                order
            }))
        )
        .andThen((filters) =>
            parseFolder(options.folder).map((folder) => ({ ...filters, folder }))
        );
}

function showFiles(
    context: CliContext,
    files: readonly FileGroup[],
    filters: Filters,
    json = false,
    owner = false
): void {
    const scoped =
        filters.folder === undefined
            ? files
            : files.filter((file) => file.folder === filters.folder);
    const filtered = filterFiles(scoped, filters.query, filters.type, filters.days);
    const shown = sortFiles(filtered, filters.order);

    if (json) {
        printJson(
            context,
            shown.map((file) => fileJson(file, owner ? file.email : undefined))
        );

        return;
    }
    if (!shown.length) {
        status(context).info('No files found.');

        return;
    }

    printTable(
        context,
        owner ? GROUP_FILE_TABLE_HEAD : FILE_TABLE_HEAD,
        shown.map((file) => fileRow(file, owner ? file.email : undefined))
    );
}

export function reportGroupState(context: CliContext, library: GroupLibraryView): void {
    for (const account of library.accounts) {
        if (account.status === 'ok') continue;

        status(context).warn(
            `${account.email}: ${account.message ?? (account.status === 'paused' ? 'paused' : 'unavailable')}`
        );
    }
}

function listGroupFiles(
    context: CliContext,
    config: CliConfig,
    groupName: string,
    query: string | undefined,
    options: ListOptions
): AsyncResult<void, CliError> {
    return findGroup(config, groupName).andThenAsync(async (group) => {
        const filters = parseFilters(context, config, query, options);
        if (filters.isErr()) return filters;

        const library = await readGroupLibrary(config, group);
        if (library.isErr()) return library;

        reportGroupState(context, library.unwrap());
        if (options.folders)
            showFolders(context, library.unwrap().files, filters.unwrap().folder, options.json);
        else showFiles(context, library.unwrap().files, filters.unwrap(), options.json, true);

        return Ok(undefined);
    });
}

export function listFiles(
    context: CliContext,
    query: string | undefined,
    options: ListOptions
): AsyncResult<void, CliError> {
    if (options.group && options.account)
        return Err({
            code: 'INVALID_OPTION',
            message: 'Use either --group or --account, not both.'
        } as const).andThenAsync(async () => Ok(undefined));

    const output = jsonContext(context, options.json);

    if (options.group)
        return readConfig(output.configPath).andThenAsync((config) =>
            listGroupFiles(output, config, options.group!, query, options)
        );

    return openSession(output, options.account).andThenAsync((session) =>
        parseFilters(output, session.config, query, options).andThenAsync((filters) =>
            loadFiles(output, session).map((files) => {
                if (options.folders) showFolders(output, files, filters.folder, options.json);
                else showFiles(output, files, filters, options.json);
            })
        )
    );
}
