import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';
import {
    ConcurrentWorkersSchema,
    FileSort,
    FileSortSchema,
    MAX_CONCURRENT_WORKERS,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { parsePreferencesDefaults } from '@madkarmaa/phodrive-core/preferences';
import type { CliConfig, StoredSettings } from './config';
import type { CliError } from './context';

export enum SettingKey {
    Sort = 'sort',
    Workers = 'workers'
}

export enum SettingSource {
    Saved = 'saved',
    Default = 'default'
}

const SettingKeySchema = z.enum(SettingKey);

const WorkersInputSchema = z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(ConcurrentWorkersSchema);

type SettingDefinition = {
    description: string;
    allowed: string;
    parse: (raw: string) => Result<StoredSettings, CliError>;
    saved: (settings: StoredSettings) => string | number | undefined;
    fallback: (defaults: PreferencesDefaults) => string | number;
};

const SORT_VALUES = Object.values(FileSort).join(', ');
const WORKER_VALUES = `whole numbers from 1 to ${MAX_CONCURRENT_WORKERS}`;

function invalidValue(name: string, allowed: string): Result<never, CliError> {
    return Err({
        code: 'INVALID_OPTION',
        message: `Invalid ${name}. Allowed values: ${allowed}.`
    } as const);
}

function parseSort(raw: string): Result<FileSort, CliError> {
    const parsed = FileSortSchema.safeParse(raw.trim());

    return parsed.success ? Ok(parsed.data) : invalidValue(SettingKey.Sort, SORT_VALUES);
}

function parseWorkers(raw: string): Result<number, CliError> {
    const parsed = WorkersInputSchema.safeParse(raw);

    return parsed.success ? Ok(parsed.data) : invalidValue(SettingKey.Workers, WORKER_VALUES);
}

const SETTINGS: Record<SettingKey, SettingDefinition> = {
    [SettingKey.Sort]: {
        description: 'File list order',
        allowed: SORT_VALUES,
        parse: (raw) => parseSort(raw).map((sort) => ({ sort })),
        saved: (settings) => settings.sort,
        fallback: (defaults) => defaults.fileSort
    },
    [SettingKey.Workers]: {
        description: 'Concurrent transfers',
        allowed: WORKER_VALUES,
        parse: (raw) => parseWorkers(raw).map((workers) => ({ workers })),
        saved: (settings) => settings.workers,
        fallback: (defaults) => defaults.concurrentWorkers
    }
};

export type SettingValue = {
    key: SettingKey;
    value: string | number;
    source: SettingSource;
    description: string;
    allowed: string;
};

type Environment = Record<string, string | undefined>;

/** Deployment defaults from the environment apply wherever no value has been saved. */
function readDefaults(environment: Environment): PreferencesDefaults {
    return parsePreferencesDefaults({
        PHODRIVE_DEFAULT_SORT: environment.PHODRIVE_DEFAULT_SORT,
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: environment.PHODRIVE_DEFAULT_CONCURRENT_WORKERS
    });
}

export function settingValue(
    config: CliConfig,
    environment: Environment,
    key: SettingKey
): SettingValue {
    const definition = SETTINGS[key];
    const saved = definition.saved(config.settings);

    return {
        key,
        value: saved ?? definition.fallback(readDefaults(environment)),
        source: saved === undefined ? SettingSource.Default : SettingSource.Saved,
        description: definition.description,
        allowed: definition.allowed
    };
}

export function settingValues(config: CliConfig, environment: Environment): SettingValue[] {
    return Object.values(SettingKey).map((key) => settingValue(config, environment, key));
}

/** A command option overrides the saved setting for one run. */
export function chooseSort(
    config: CliConfig,
    environment: Environment,
    option?: string
): Result<FileSort, CliError> {
    if (option === undefined) return Ok(config.settings.sort ?? readDefaults(environment).fileSort);

    return parseSort(option);
}

export function chooseWorkers(
    config: CliConfig,
    environment: Environment,
    option?: string
): Result<number, CliError> {
    if (option === undefined)
        return Ok(config.settings.workers ?? readDefaults(environment).concurrentWorkers);

    return parseWorkers(option);
}

export function parseSettingKey(raw: string): Result<SettingKey, CliError> {
    const parsed = SettingKeySchema.safeParse(raw.trim());
    if (parsed.success) return Ok(parsed.data);

    return Err({
        code: 'INVALID_OPTION',
        message: `Unknown setting ${raw}. Settings: ${Object.values(SettingKey).join(', ')}.`
    } as const);
}

export function saveSetting(
    config: CliConfig,
    key: SettingKey,
    raw: string
): Result<CliConfig, CliError> {
    return SETTINGS[key]
        .parse(raw)
        .map((setting) => ({ ...config, settings: { ...config.settings, ...setting } }));
}

export function resetSetting(config: CliConfig, key: SettingKey): CliConfig {
    const settings = { ...config.settings };
    delete settings[key];

    return { ...config, settings };
}
