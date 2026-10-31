// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { DriveGroupMode } from '#browser/drive/group-mode';
import { DriveGroups } from '#browser/drive/groups.svelte';
import { groupLibraryAccess, groupUploadAccess } from '#browser/drive/wiring';
import { BrowserPreferences } from '#browser/storage';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

let groups: DriveGroups | null = null;

function setup() {
    const preferences = new BrowserPreferences();
    preferences.saveGroups([{ id: 'family', name: 'Family', accounts: [FIRST, SECOND] }]).unwrap();
    preferences.saveUploadTarget('family').unwrap();

    const store = new DriveGroups(
        () => preferences,
        () => ({ [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second' })
    );
    const settings = {
        uploadTarget: 'family',
        chooseUploadTarget: vi.fn()
    };
    const mode = new DriveGroupMode(
        () => store,
        () => settings,
        () => ({ [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second' }),
        () => {}
    );
    groups = store;

    return { store, mode, settings };
}

afterEach(() => {
    groups?.clearPauses();
    groups = null;
});

test('listing state reaches member status through the wiring', () => {
    const { store, mode } = setup();
    const access = groupLibraryAccess(mode, store);

    access.onAccounts([
        { email: FIRST, status: 'ok' },
        { email: SECOND, status: 'paused', retryAfterSeconds: 30 }
    ]);

    expect(store.memberStatus(FIRST)).toBe('ready');
    expect(store.isPaused(SECOND)).toBe(true);
});

test('an upload retry reaches the pause and excludes that member', () => {
    const { store, mode } = setup();
    const access = groupUploadAccess(mode, store, () => {});
    const until = Date.now() + 30_000;

    access.markPaused(FIRST, until);

    expect(store.pausedUntilFor(FIRST)).toBe(until);
    expect(access.group()?.members.find((member) => member.email === FIRST)?.paused).toBe(true);
});

test('changing the upload target clears pauses and the stale group error', () => {
    const { store, mode } = setup();
    store.markPaused(FIRST, Date.now() + 30_000);
    store.error = 'Old error';

    mode.choose('');

    expect(store.pausedUntilFor(FIRST)).toBe(0);
    expect(store.error).toBe('');
});
