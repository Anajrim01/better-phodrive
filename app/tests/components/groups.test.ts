// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Group } from '@madkarmaa/phodrive-core/models';
import GroupCard from '#components/GroupCard.svelte';
import GroupsSettings from '#components/GroupsSettings.svelte';
import { DriveGroups } from '#browser/drive/groups.svelte';
import { BrowserPreferences } from '#browser/storage';

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
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false
        })
    });
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    );
    Object.defineProperty(Element.prototype, 'animate', {
        configurable: true,
        value: () => ({
            cancel: () => {},
            finish: () => {},
            finished: Promise.resolve(),
            addEventListener: () => {},
            removeEventListener: () => {}
        })
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

let preferences: BrowserPreferences;

function store(groups: Group[] = []): DriveGroups {
    preferences = new BrowserPreferences();
    if (groups.length) preferences.saveGroups(groups).unwrap();

    return new DriveGroups(
        () => preferences,
        () => ({ [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second' })
    );
}

function group(accounts: string[] = [FIRST, SECOND]): Group {
    return { id: 'family', name: 'Family', accounts };
}

beforeEach(() => {
    storage.clear();
    cleanup();
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('the no-groups empty state shows the create form', () => {
    render(GroupsSettings, { props: { store: store() } });

    expect(screen.getByText('No groups yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create group' })).toBeTruthy();
    expect(screen.getAllByText('Group name').length).toBeGreaterThan(0);
});

test('a single-member group explains that it cannot shard yet', () => {
    render(GroupsSettings, { props: { store: store([group([FIRST])]) } });

    expect(screen.getByText('Add one more account before uploading with this group.')).toBeTruthy();
});

test('a group with every member paused shows the paused empty state', () => {
    const driveGroups = store([group()]);
    driveGroups.applyAccountStates([
        { email: FIRST, status: 'paused', retryAfterSeconds: 30 },
        { email: SECOND, status: 'paused', retryAfterSeconds: 30 }
    ]);
    render(GroupsSettings, { props: { store: driveGroups } });

    expect(
        screen.getByText('Every member is paused. Uploads wait until one recovers.')
    ).toBeTruthy();
});

test('removing a member shows the warning and can be cancelled', async () => {
    const removing = vi.fn(() => true);
    const { container } = render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            memberStatus: () => 'unknown',
            onrename: vi.fn(() => true),
            ondelete: vi.fn(),
            onaddmember: vi.fn(() => true),
            onremovemember: removing
        }
    });

    await fireEvent.click(screen.getByRole('button', { name: `Remove ${FIRST} from Family` }));

    expect(screen.getByText(`Remove ${FIRST}?`)).toBeTruthy();
    expect(screen.getByText('Files already uploaded stay with this account.')).toBeTruthy();

    await fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText(`Remove ${FIRST}?`)).toBeNull();
    expect(removing).not.toHaveBeenCalled();
    expect(container.querySelector('article')).toBeTruthy();
});

test('removing a member keeps the warning open when the store refuses', async () => {
    render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            memberStatus: () => 'unknown',
            onrename: vi.fn(() => true),
            ondelete: vi.fn(),
            onaddmember: vi.fn(() => true),
            onremovemember: vi.fn(() => false)
        }
    });

    await fireEvent.click(screen.getByRole('button', { name: `Remove ${FIRST} from Family` }));
    await fireEvent.click(screen.getByText('Remove'));

    expect(screen.getByText(`Remove ${FIRST}?`)).toBeTruthy();
});

test('deleting a group asks for confirmation and explains where files stay', async () => {
    const deleting = vi.fn();
    render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            memberStatus: () => 'unknown',
            onrename: vi.fn(() => true),
            ondelete: deleting,
            onaddmember: vi.fn(() => true),
            onremovemember: vi.fn(() => true)
        }
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));

    expect(screen.getByText('Delete Family?')).toBeTruthy();
    expect(screen.getByText('Files already uploaded stay with their owners.')).toBeTruthy();

    await fireEvent.click(screen.getByText('Cancel'));
    expect(deleting).not.toHaveBeenCalled();
});

test('member status stays unknown without an observation', () => {
    render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            memberStatus: () => 'unknown',
            onrename: vi.fn(() => true),
            ondelete: vi.fn(),
            onaddmember: vi.fn(() => true),
            onremovemember: vi.fn(() => true)
        }
    });

    expect(screen.getAllByText('Unknown')).toHaveLength(2);
});

test('member status shows paused and ready', () => {
    render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            memberStatus: (email) => (email === FIRST ? 'paused' : 'ready'),
            onrename: vi.fn(() => true),
            ondelete: vi.fn(),
            onaddmember: vi.fn(() => true),
            onremovemember: vi.fn(() => true)
        }
    });

    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
});
