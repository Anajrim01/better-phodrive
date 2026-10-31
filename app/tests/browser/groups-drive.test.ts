import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DriveGroups } from '#browser/drive/groups.svelte';
import { groupReadiness } from '#browser/drive/group-state';
import { BrowserPreferences } from '#browser/storage';
import type { Group } from '@madkarmaa/phodrive-core/models';

const { storage } = vi.hoisted(() => {
    class MemoryStorage implements Storage {
        private readonly items = new Map<string, string>();

        get length(): number {
            return this.items.size;
        }

        key(index: number): string | null {
            return [...this.items.keys()][index] ?? null;
        }

        getItem(key: string): string | null {
            return this.items.get(key) ?? null;
        }

        setItem(key: string, value: string): void {
            this.items.set(key, value);
        }

        removeItem(key: string): void {
            this.items.delete(key);
        }

        clear(): void {
            this.items.clear();
        }
    }

    const storage = new MemoryStorage();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';
const THIRD = 'third@example.com';

let preferences: BrowserPreferences;

function groups(): DriveGroups {
    return new DriveGroups(
        () => preferences,
        () => ({ [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second', [THIRD]: 'aas_et/third' })
    );
}

function group(accounts: string[]): Group {
    return { id: 'family', name: 'Family', accounts };
}

beforeEach(() => {
    storage.clear();
    preferences = new BrowserPreferences();
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('the group store creates, renames, edits, and deletes groups', () => {
    const store = groups();

    expect(store.create('Family', [FIRST, SECOND])).toBe(true);
    const [created] = preferences.groups;
    expect(created).toMatchObject({ name: 'Family', accounts: [FIRST, SECOND] });

    expect(store.rename(created!.id, 'Friends')).toBe(true);
    expect(preferences.groups[0]?.name).toBe('Friends');

    store.addMember(created!.id, THIRD);
    expect(preferences.groups[0]?.accounts).toEqual([FIRST, SECOND, THIRD]);

    store.removeMember(created!.id, SECOND);
    expect(preferences.groups[0]?.accounts).toEqual([FIRST, THIRD]);

    store.delete(created!.id);
    expect(preferences.groups).toEqual([]);
});

test('the group store reports validation errors without changing storage', () => {
    const store = groups();

    expect(store.create('', [FIRST, SECOND])).toBe(false);
    expect(store.error).toBeTruthy();

    expect(store.create('Family', [FIRST])).toBe(false);
    expect(store.error).toBe('Choose at least two accounts for a group.');

    expect(store.create('Family', [FIRST, 'missing@example.com'])).toBe(false);
    expect(store.error).toBe('Connect every chosen account before creating the group.');

    expect(store.create('Family', [FIRST, SECOND])).toBe(true);
    expect(store.create('family', [FIRST, THIRD])).toBe(false);
    expect(store.error).toBe('A group named family already exists.');

    const [created] = preferences.groups;
    store.addMember(created!.id, FIRST);
    expect(store.error).toBe(`${FIRST} is already in Family.`);

    store.addMember(created!.id, 'missing@example.com');
    expect(store.error).toBe('Connect that account before adding it to a group.');

    expect(preferences.groups[0]?.accounts).toEqual([FIRST, SECOND]);
});

test('removing the last member is refused', () => {
    const store = groups();
    store.create('Family', [FIRST, SECOND]);
    const [created] = preferences.groups;

    store.removeMember(created!.id, SECOND);
    store.removeMember(created!.id, FIRST);

    expect(store.error).toBe('A group needs at least one account. Delete the group instead.');
    expect(preferences.groups[0]?.accounts).toEqual([FIRST]);
});

test('the paused state is tracked for member status', () => {
    const store = groups();
    store.create('Family', [FIRST, SECOND]);
    const [created] = preferences.groups;

    store.setPausedEmails([FIRST.toUpperCase()]);
    expect(store.pausedEmails).toEqual([FIRST]);
    expect(groupReadiness(created!, store.pausedEmails)).toBe('ready');

    store.setPausedEmails([FIRST, SECOND]);
    expect(groupReadiness(created!, store.pausedEmails)).toBe('all-paused');
});

test('the upload target defaults to the current account and persists', () => {
    expect(preferences.uploadTarget).toBe('');
    expect(preferences.saveUploadTarget('family').isOk()).toBe(true);
    expect(new BrowserPreferences().uploadTarget).toBe('family');
});

test('group readiness covers the three empty states', () => {
    expect(preferences.groups).toEqual([]);

    const oneMember = group([FIRST]);
    expect(groupReadiness(oneMember, [])).toBe('needs-members');

    const allPaused = group([FIRST, SECOND]);
    expect(groupReadiness(allPaused, [FIRST.toUpperCase(), SECOND])).toBe('all-paused');

    expect(groupReadiness(allPaused, [FIRST])).toBe('ready');
});
