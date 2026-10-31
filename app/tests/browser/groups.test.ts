import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BrowserPreferences, GROUPS_KEY, GROUPS_SERIALIZER } from '#browser/storage';

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

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('groups default to empty and round-trip through browser storage', () => {
    const preferences = new BrowserPreferences();

    expect(preferences.groups).toEqual([]);
    expect(storage.getItem(GROUPS_KEY)).toBe('[]');

    const groups = [{ id: 'home', name: 'Home', accounts: ['one@example.com', 'two@example.com'] }];

    expect(preferences.saveGroups(groups).isOk()).toBe(true);
    expect(storage.getItem(GROUPS_KEY)).toBe(JSON.stringify(groups));
    expect(new BrowserPreferences().groups).toEqual(groups);

    const invalidGroups = [
        [{ id: 'empty', name: 'Empty', accounts: [] }],
        [
            {
                id: 'duplicate-account',
                name: 'Duplicate account',
                accounts: ['one@example.com', 'one@example.com']
            }
        ],
        [
            { id: 'same-id', name: 'First', accounts: ['one@example.com'] },
            { id: 'same-id', name: 'Second', accounts: ['two@example.com'] }
        ]
    ];

    for (const invalid of invalidGroups) {
        const rejected = preferences.saveGroups(invalid);

        expect(rejected.isErr()).toBe(true);
        if (rejected.isErr()) expect(rejected.unwrapErr()).toMatchObject({ code: 'INVALID_GROUP' });
    }
    expect(new BrowserPreferences().groups).toEqual(groups);

    storage.setItem(
        GROUPS_KEY,
        JSON.stringify([
            { id: 'kept', name: 'Kept', accounts: ['one@example.com'] },
            { id: 'kept', name: 'Duplicate id', accounts: ['two@example.com'] },
            { id: 'bad', name: 'Bad', accounts: ['not-an-email'] }
        ])
    );

    expect(new BrowserPreferences().groups).toEqual([
        { id: 'kept', name: 'Kept', accounts: ['one@example.com'] }
    ]);
    expect(GROUPS_SERIALIZER.deserialize('{')).toEqual([]);
});
