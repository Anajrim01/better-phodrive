import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import { Err, Ok, type Result } from 'results-ts';
import type { z } from 'zod';
import {
    AccountSchema,
    ConcurrentWorkersSchema,
    DEFAULT_FILE_LAYOUT,
    DEFAULT_PREFERENCES_DEFAULTS,
    FileLayout,
    FileLayoutSchema,
    FileSort,
    FileSortSchema,
    MAX_CONCURRENT_WORKERS,
    MAX_REFRESH_INTERVAL_SECONDS,
    RefreshIntervalSchema,
    SelectedAccountSchema,
    StoredAccountsSchema,
    ThemeMode,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { AlbumKeys, ALBUMS_KEY } from '#browser/albums';
import {
    readState,
    readStoredJson,
    resetState,
    STORAGE_UNAVAILABLE,
    writeState
} from '#browser/persisted';

export { ALBUMS_KEY };

export const ACCOUNTS_KEY = 'accounts';
export const SELECTED_KEY = 'selectedAccount';
export const THEME_KEY = 'phodrive-theme';
export const FILE_SORT_KEY = 'phodrive-sort';
export const FILE_LAYOUT_KEY = 'phodrive-layout';
export const REFRESH_INTERVAL_KEY = 'phodrive-refresh-interval';
export const CONCURRENT_WORKERS_KEY = 'phodrive-concurrent-workers';
export const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
    [ThemeMode.Auto]: ThemeMode.Light,
    [ThemeMode.Light]: ThemeMode.Dark,
    [ThemeMode.Dark]: ThemeMode.Auto
};

type Accounts = Record<string, string>;

/** Enum choices are stored as their raw values; an invalid value falls back to the default. */
function enumSerializer<T extends string>(schema: z.ZodType<T>) {
    return {
        serialize: (value: T | undefined) => value ?? '',
        deserialize: (raw: string): T | undefined => {
            const parsed = schema.safeParse(raw);

            return parsed.success ? parsed.data : undefined;
        }
    };
}

/** Null is a saved reset marker, while undefined means no saved choice. */
function nullableNumberSerializer(schema: z.ZodType<number>) {
    return {
        serialize: (value: number | null | undefined) =>
            value === undefined ? '' : JSON.stringify(value),
        deserialize: (raw: string): number | null | undefined => {
            const parsed = schema.nullable().safeParse(readStoredJson(raw));

            return parsed.success ? parsed.data : undefined;
        }
    };
}

export const ACCOUNTS_SERIALIZER = {
    serialize: (accounts: Accounts) => JSON.stringify(accounts),
    deserialize: (raw: string): Accounts => {
        const parsed = StoredAccountsSchema.safeParse(readStoredJson(raw));
        if (!parsed.success) return {};

        const valid: Accounts = {};
        for (const [email, token] of Object.entries(parsed.data)) {
            const account = AccountSchema.safeParse({ email, token });
            if (!account.success) continue;

            valid[account.data.email] = account.data.token;
        }

        return valid;
    }
};

export const THEME_SERIALIZER = enumSerializer(ThemeSchema);
export const FILE_SORT_SERIALIZER = enumSerializer(FileSortSchema);
export const FILE_LAYOUT_SERIALIZER = enumSerializer(FileLayoutSchema);
export const REFRESH_INTERVAL_SERIALIZER = nullableNumberSerializer(RefreshIntervalSchema);
export const CONCURRENT_WORKERS_SERIALIZER = nullableNumberSerializer(ConcurrentWorkersSchema);

/** JSON encodes an empty selection as a nonempty string so Runed reads it from storage. */
export const SELECTED_ACCOUNT_SERIALIZER = {
    serialize: (email: string) => JSON.stringify(email),
    deserialize: (raw: string): string => {
        const parsed = SelectedAccountSchema.safeParse(readStoredJson(raw));

        return parsed.success ? parsed.data : '';
    }
};

/** Per-page reactive preferences, with validated data and synchronization across tabs. */
export class BrowserPreferences {
    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {}

    private readonly accountsState = new PersistedState<Accounts>(
        ACCOUNTS_KEY,
        {},
        {
            serializer: ACCOUNTS_SERIALIZER
        }
    );
    private readonly selectedState = new PersistedState(SELECTED_KEY, '', {
        serializer: SELECTED_ACCOUNT_SERIALIZER
    });
    // Runed skips undefined writes, so deployment defaults apply until the user saves a choice.
    private readonly themeState = new PersistedState<ThemeMode | undefined>(THEME_KEY, undefined, {
        serializer: THEME_SERIALIZER
    });
    private readonly fileSortState = new PersistedState<FileSort | undefined>(
        FILE_SORT_KEY,
        undefined,
        {
            serializer: FILE_SORT_SERIALIZER
        }
    );
    private readonly refreshIntervalState = new PersistedState<number | null | undefined>(
        REFRESH_INTERVAL_KEY,
        undefined,
        { serializer: REFRESH_INTERVAL_SERIALIZER }
    );
    private readonly fileLayoutState = new PersistedState<FileLayout | undefined>(
        FILE_LAYOUT_KEY,
        undefined,
        { serializer: FILE_LAYOUT_SERIALIZER }
    );
    private readonly concurrentWorkersState = new PersistedState<number | null | undefined>(
        CONCURRENT_WORKERS_KEY,
        undefined,
        { serializer: CONCURRENT_WORKERS_SERIALIZER }
    );
    private readonly albumKeys = new AlbumKeys();

    get accounts(): Accounts {
        return readState(this.accountsState).unwrapOr({});
    }

    get selectedEmail(): string {
        const preferred = readState(this.selectedState).unwrapOr('');
        const accounts = this.accounts;

        return Object.hasOwn(accounts, preferred) ? preferred : (Object.keys(accounts)[0] ?? '');
    }

    get theme(): ThemeMode {
        return readState(this.themeState).unwrapOr(undefined) ?? this.defaults.theme;
    }

    get fileSort(): FileSort {
        return readState(this.fileSortState).unwrapOr(undefined) ?? this.defaults.fileSort;
    }

    get fileLayout(): FileLayout {
        return readState(this.fileLayoutState).unwrapOr(undefined) ?? DEFAULT_FILE_LAYOUT;
    }

    get refreshIntervalSeconds(): number {
        return (
            readState(this.refreshIntervalState).unwrapOr(undefined) ??
            this.defaults.refreshIntervalSeconds
        );
    }

    get concurrentWorkers(): number {
        return (
            readState(this.concurrentWorkersState).unwrapOr(undefined) ??
            this.defaults.concurrentWorkers
        );
    }

    albumKey(email: string, folder: string): string | undefined {
        return this.albumKeys.get(email, folder);
    }

    saveAlbumKey(email: string, folder: string, albumKey: string): Result<void, ApplicationError> {
        return this.albumKeys.save(email, folder, albumKey);
    }

    saveAccounts(accounts: Accounts, selected: string): Result<void, ApplicationError> {
        return writeState(this.accountsState, accounts).andThen(() =>
            writeState(this.selectedState, selected)
        );
    }

    selectAccount(email: string): Result<void, ApplicationError> {
        return writeState(this.selectedState, email);
    }

    saveTheme(mode: ThemeMode): Result<void, ApplicationError> {
        return writeState(this.themeState, mode);
    }

    saveFileSort(order: FileSort): Result<void, ApplicationError> {
        return writeState(this.fileSortState, order);
    }

    saveFileLayout(layout: FileLayout): Result<void, ApplicationError> {
        return writeState(this.fileLayoutState, layout);
    }

    saveRefreshInterval(seconds: number): Result<void, ApplicationError> {
        const parsed = RefreshIntervalSchema.safeParse(seconds);
        if (!parsed.success) {
            return Err({
                code: 'INVALID_REFRESH_INTERVAL',
                message: `Refresh interval must be a whole number from 0 to ${MAX_REFRESH_INTERVAL_SECONDS} seconds.`
            } as const);
        }

        return writeState(this.refreshIntervalState, parsed.data);
    }

    saveConcurrentWorkers(workers: number): Result<void, ApplicationError> {
        const parsed = ConcurrentWorkersSchema.safeParse(workers);
        if (!parsed.success) {
            return Err({
                code: 'INVALID_CONCURRENT_WORKERS',
                message: `Concurrent workers must be a whole number from 1 to ${MAX_CONCURRENT_WORKERS}.`
            } as const);
        }

        return writeState(this.concurrentWorkersState, parsed.data);
    }

    resetRefreshInterval(): Result<void, ApplicationError> {
        return resetState(this.refreshIntervalState);
    }

    resetConcurrentWorkers(): Result<void, ApplicationError> {
        return resetState(this.concurrentWorkersState);
    }
}

export function createBrowserPreferences(
    defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS
): Result<BrowserPreferences, ApplicationError> {
    let preferences: BrowserPreferences;

    try {
        preferences = new BrowserPreferences(defaults);
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }

    return Ok(preferences);
}
