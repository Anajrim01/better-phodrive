import { FileSort, ThemeMode } from '@madkarmaa/phodrive-core/models';
import { expect, test, vi } from 'vitest';
import { readPreferencesDefaults } from '#server/preferences';

const { environment } = vi.hoisted(() => ({
    environment: {
        PHODRIVE_DEFAULT_THEME: 'dark',
        PHODRIVE_DEFAULT_SORT: 'name-desc',
        PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS: '90',
        PHODRIVE_DEFAULT_CONCURRENT_WORKERS: '12'
    }
}));

vi.mock('$app/env/private', () => environment);

test('reads named deployment defaults from the SvelteKit environment', () => {
    expect(readPreferencesDefaults()).toEqual({
        theme: ThemeMode.Dark,
        fileSort: FileSort.NameDescending,
        refreshIntervalSeconds: 90,
        concurrentWorkers: 12
    });
});
