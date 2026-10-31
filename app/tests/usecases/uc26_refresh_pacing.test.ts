import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { CONCURRENT_WORKERS_KEY, SELECTED_KEY } from '#browser/storage';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };
    const tab = Object.assign(new EventTarget(), { localStorage: storage });
    vi.stubGlobal('window', tab);
    vi.stubGlobal('document', {
        hidden: false,
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

const OWNER = 'owner@example.com';

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

function emptySnapshot() {
    return Ok({ items: [], nextPageToken: '', pages: 0 }).andThenAsync(async (page) => Ok(page));
}

beforeEach(() => {
    vi.restoreAllMocks();
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ [OWNER]: 'aas_et/owner-token' }));
    storage.setItem(SELECTED_KEY, JSON.stringify(OWNER));
    storage.setItem(CONCURRENT_WORKERS_KEY, '1');
});

afterAll(() => vi.unstubAllGlobals());

test('automatic refresh waits for a throttling window while a manual refresh does not', async () => {
    const read = vi.spyOn(libraryApi, 'readLibrarySnapshot').mockReturnValue(
        Err({
            code: 'THROTTLED',
            message: 'Google is throttling requests. Retrying in about 2 min.',
            retryAfterSeconds: 120
        } as const).andThenAsync(async () => Ok({ items: [], nextPageToken: '', pages: 0 }))
    );
    const drive = new DriveController();
    drive.initialize();

    await drive.library.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    expect(drive.library.retryAt).toBeGreaterThan(Date.now());

    await drive.library.refresh();
    expect(read).toHaveBeenCalledTimes(1);

    await drive.library.refresh(true);
    expect(read).toHaveBeenCalledTimes(2);
});

test('the upload cooldown defers automatic refresh but keeps the button responsive', async () => {
    const read = vi.spyOn(libraryApi, 'readLibrarySnapshot').mockReturnValue(emptySnapshot());
    const drive = new DriveController();
    drive.initialize();
    drive.library.deferRefresh();

    await drive.library.refresh();
    expect(read).not.toHaveBeenCalled();

    await drive.library.refresh(true);
    expect(read).toHaveBeenCalledTimes(1);
});
