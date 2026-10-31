import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';
import writeFileAtomic from 'write-file-atomic';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { z } from 'zod';
import {
    AccountSchema,
    FileSortSchema,
    SelectedAccountSchema,
    StoredAccountsSchema,
    StoredAlbumsSchema,
    WorkerCountSchema,
    type StoredAlbums
} from '@madkarmaa/phodrive-core/models';
import type { CliError } from './context';
import { isMissingPath } from './filesystem';

export const CONFIG_PATH_VARIABLE = 'PHODRIVE_CONFIG';
const CONFIG_FILE_NAME = 'config.json';
// Credentials are readable only by the current user where the platform supports modes.
const CONFIG_FILE_MODE = 0o600;
const CONFIG_FOLDER_MODE = 0o700;

const StoredSettingsSchema = z.object({
    sort: FileSortSchema.optional().catch(undefined),
    // Counts above this machine's processors are kept and limited when used.
    workers: WorkerCountSchema.optional().catch(undefined)
});

const StoredConfigSchema = z.object({
    accounts: StoredAccountsSchema.catch({}),
    selected: SelectedAccountSchema.catch(''),
    settings: StoredSettingsSchema.catch({}),
    albums: StoredAlbumsSchema.catch({})
});

export type StoredSettings = z.infer<typeof StoredSettingsSchema>;
export type CliConfig = {
    accounts: Record<string, string>;
    selected: string;
    settings: StoredSettings;
    albums: StoredAlbums;
};

const EMPTY_CONFIG: CliConfig = { accounts: {}, selected: '', settings: {}, albums: {} };

export function defaultConfigPath(environment: Record<string, string | undefined>): string {
    const override = environment[CONFIG_PATH_VARIABLE]?.trim();
    if (override) return override;

    return join(envPaths('phodrive', { suffix: '' }).config, CONFIG_FILE_NAME);
}

/** Unknown or invalid entries are dropped, as the web app does with browser storage. */
function parseConfig(value: unknown): CliConfig {
    const parsed = StoredConfigSchema.catch(EMPTY_CONFIG).parse(value);
    const accounts: Record<string, string> = {};

    for (const [email, token] of Object.entries(parsed.accounts)) {
        const account = AccountSchema.safeParse({ email, token });
        if (!account.success) continue;

        accounts[account.data.email] = account.data.token;
    }

    return {
        accounts,
        selected: parsed.selected,
        settings: parsed.settings,
        albums: parsed.albums
    };
}

function parseJson(text: string, path: string): Result<unknown, CliError> {
    try {
        const value: unknown = JSON.parse(text);

        return Ok(value);
    } catch {
        return Err({
            code: 'CONFIG_READ_FAILED',
            message: `${path} is not valid JSON. Fix or delete it, then try again.`
        } as const);
    }
}

export function readConfig(path: string): AsyncResult<CliConfig, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        let text: string;

        try {
            text = await readFile(path, 'utf8');
        } catch (error) {
            if (isMissingPath(error)) return Ok(EMPTY_CONFIG);

            return Err({ code: 'CONFIG_READ_FAILED', message: `Could not read ${path}.` } as const);
        }

        return parseJson(text, path).map(parseConfig);
    });
}

export function writeConfig(path: string, config: CliConfig): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        const text = `${JSON.stringify(config, null, 4)}\n`;

        try {
            await mkdir(dirname(path), { recursive: true, mode: CONFIG_FOLDER_MODE });
            await writeFileAtomic(path, text, { mode: CONFIG_FILE_MODE });
        } catch {
            return Err({
                code: 'CONFIG_WRITE_FAILED',
                message: `Could not save ${path}.`
            } as const);
        }

        return Ok(undefined);
    });
}

/** Read, change, and save the configuration in one step. */
export function updateConfig(
    path: string,
    change: (config: CliConfig) => Result<CliConfig, CliError>
): AsyncResult<CliConfig, CliError> {
    return readConfig(path)
        .andThen(change)
        .andThenAsync((updated) => writeConfig(path, updated).map(() => updated));
}
