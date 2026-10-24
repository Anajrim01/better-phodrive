import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';
import {
    DEFAULT_CONCURRENT_WORKERS,
    FileSort,
    FileSortSchema,
    WorkerCountSchema
} from '@madkarmaa/phodrive-core/models';
import { maxWorkers } from '@madkarmaa/phodrive-core/node';
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
    .pipe(WorkerCountSchema);

type Environment = Record<string, string | undefined>;
type SettingDefinition = {
    description: string;
    allowed: () => string;
    parse: (raw: string) => Result<StoredSettings, CliError>;
    saved: (settings: StoredSettings) => string | number | undefined;
    fallback: (environment: Environment) => string | number;
};

const SORT_VALUES = Object.values(FileSort).join(', ');

/** The command line may use one worker per processor, detected each time it runs. */
function workerValues(): string {
    return `whole numbers from 1 to ${maxWorkers()}`;
}

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
    if (!parsed.success || parsed.data > maxWorkers())
        return invalidValue(SettingKey.Workers, workerValues());

    return Ok(parsed.data);
}

function defaultSort(environment: Environment): FileSort {
    return parsePreferencesDefaults({ PHODRIVE_DEFAULT_SORT: environment.PHODRIVE_DEFAULT_SORT })
        .fileSort;
}

/** The deployment default applies when it fits this machine, as invalid web defaults do. */
function defaultWorkers(environment: Environment): number {
    const configured = environment.PHODRIVE_DEFAULT_CONCURRENT_WORKERS ?? '';
    const fallback = Math.min(DEFAULT_CONCURRENT_WORKERS, maxWorkers());

    return parseWorkers(configured).match({ Ok: (workers) => workers, Err: () => fallback });
}

/** A saved count from a machine with more processors still runs within this one. */
function savedWorkers(settings: StoredSettings): number | undefined {
    if (settings.workers === undefined) return undefined;

    return Math.min(settings.workers, maxWorkers());
}

const SETTINGS: Record<SettingKey, SettingDefinition> = {
    [SettingKey.Sort]: {
        description: 'File list order',
        allowed: () => SORT_VALUES,
        parse: (raw) => parseSort(raw).map((sort) => ({ sort })),
        saved: (settings) => settings.sort,
        fallback: defaultSort
    },
    [SettingKey.Workers]: {
        description: 'Concurrent transfers',
        allowed: workerValues,
        parse: (raw) => parseWorkers(raw).map((workers) => ({ workers })),
        saved: savedWorkers,
        fallback: defaultWorkers
    }
};

export type SettingValue = {
    key: SettingKey;
    value: string | number;
    source: SettingSource;
    description: string;
    allowed: string;
};

export function settingValue(
    config: CliConfig,
    environment: Environment,
    key: SettingKey
): SettingValue {
    const definition = SETTINGS[key];
    const saved = definition.saved(config.settings);

    return {
        key,
        value: saved ?? definition.fallback(environment),
        source: saved === undefined ? SettingSource.Default : SettingSource.Saved,
        description: definition.description,
        allowed: definition.allowed()
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
    if (option === undefined) return Ok(config.settings.sort ?? defaultSort(environment));

    return parseSort(option);
}

export function chooseWorkers(
    config: CliConfig,
    environment: Environment,
    option?: string
): Result<number, CliError> {
    if (option === undefined)
        return Ok(savedWorkers(config.settings) ?? defaultWorkers(environment));

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
