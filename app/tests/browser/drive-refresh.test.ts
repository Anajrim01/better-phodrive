import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { DriveController } from '#browser/drive/index.svelte';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
    storage.setItem('accounts', JSON.stringify({ 'test@example.com': 'aas_et/test' }));
});

afterAll(() => vi.unstubAllGlobals());

test('a bulk move blocks library loads and pauses automatic refresh', async () => {
    const drive = new DriveController();
    drive.initialize();
    const enabled = vi.mocked(useAutomaticRefresh).mock.calls.at(-1)?.[1];
    const readPage = vi.spyOn(libraryApi, 'readLibraryPage');

    expect(enabled?.()).toBe(true);

    drive.bulk.moveOpen = true;
    expect(enabled?.()).toBe(false);

    drive.bulk.moveOpen = false;
    drive.bulk.moveBusy = true;
    expect(enabled?.()).toBe(false);

    await drive.library.load();
    expect(readPage).not.toHaveBeenCalled();
});
