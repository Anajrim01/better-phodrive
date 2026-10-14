import * as env from '$app/env/private';
import { parsePreferencesDefaults } from '@phodrive/core/preferences';
import type { PreferencesDefaults } from '@phodrive/core/models';

export function readPreferencesDefaults(): PreferencesDefaults {
    return parsePreferencesDefaults({
        PHODRIVE_DEFAULT_THEME: env.PHODRIVE_DEFAULT_THEME,
        PHODRIVE_DEFAULT_SORT: env.PHODRIVE_DEFAULT_SORT,
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: env.PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS,
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: env.PHODRIVE_DEFAULT_CONCURRENT_WORKERS
    });
}
