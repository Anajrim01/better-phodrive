import {
    ConcurrentWorkersSchema,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileSortSchema,
    RefreshIntervalSchema,
    ThemeSchema,
    type PreferencesDefaults
} from './models.js';

/** Blank deployment values are absent, rather than Number('') becoming an explicit zero. */
function environmentNumber(value: string | undefined): number | undefined {
    if (!value?.trim()) return undefined;

    return Number(value);
}

/** Read only public preference configuration, never enumerate the private environment. */
export function parsePreferencesDefaults(
    environment: Record<string, string | undefined>
): PreferencesDefaults {
    const defaults = DEFAULT_PREFERENCES_DEFAULTS;

    // Invalid deployment values fall back to the built-in defaults, so parsing cannot throw.
    return {
        theme: ThemeSchema.catch(defaults.theme).parse(environment.PHODRIVE_DEFAULT_THEME),
        fileSort: FileSortSchema.catch(defaults.fileSort).parse(environment.PHODRIVE_DEFAULT_SORT),
        refreshIntervalSeconds: RefreshIntervalSchema.catch(defaults.refreshIntervalSeconds).parse(
            environmentNumber(environment.PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS)
        ),
        concurrentWorkers: ConcurrentWorkersSchema.catch(defaults.concurrentWorkers).parse(
            environmentNumber(environment.PHODRIVE_DEFAULT_CONCURRENT_WORKERS)
        )
    };
}
