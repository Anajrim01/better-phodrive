// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Group } from '@madkarmaa/phodrive-core/models';
import GroupCard from '#components/GroupCard.svelte';
import GroupsSettings from '#components/GroupsSettings.svelte';
import GroupListingStatus from '#components/GroupListingStatus.svelte';
import UploadTarget from '#components/UploadTarget.svelte';
import FileList from '#components/FileList.svelte';
import { FileSort } from '@madkarmaa/phodrive-core/models';
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
    driveGroups.setPausedEmails([FIRST, SECOND]);
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
            pausedEmails: [],
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
            pausedEmails: [],
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
            pausedEmails: [],
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

test('member status shows paused and ready', () => {
    render(GroupCard, {
        props: {
            group: group(),
            accounts: [FIRST, SECOND],
            pausedEmails: [FIRST],
            onrename: vi.fn(() => true),
            ondelete: vi.fn(),
            onaddmember: vi.fn(() => true),
            onremovemember: vi.fn(() => true)
        }
    });

    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
});

test('the upload target lists the current account and groups', () => {
    const onchange = vi.fn();
    const { container } = render(UploadTarget, {
        props: {
            groups: [group(), { id: 'small', name: 'Small', accounts: [FIRST] }],
            value: '',
            currentEmail: FIRST,
            onchange
        }
    });

    expect(screen.getByRole('combobox', { name: 'Upload to' })).toBeTruthy();
    expect(screen.getAllByText(`Current account (${FIRST})`).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Family').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Small (needs 2 accounts)').length).toBeGreaterThan(0);
    expect(container.querySelector('select')).toBeTruthy();
});

test('a partial group listing names paused members and their wait', () => {
    render(GroupListingStatus, {
        props: {
            groupName: 'Family',
            total: 2,
            accounts: [
                { email: FIRST, status: 'ok' },
                { email: SECOND, status: 'paused', retryAfterSeconds: 30 }
            ]
        }
    });

    expect(screen.getByText('Family')).toBeTruthy();
    expect(
        screen.getByText(
            `Paused: ${SECOND} (30s). Files from paused accounts stay hidden until they answer.`
        )
    ).toBeTruthy();
});

test('a fully paused group says when files return', () => {
    render(GroupListingStatus, {
        props: {
            groupName: 'Family',
            total: 2,
            accounts: [
                { email: FIRST, status: 'paused' },
                { email: SECOND, status: 'paused' }
            ]
        }
    });

    expect(
        screen.getByText('Every member is paused. Files return when an account answers.')
    ).toBeTruthy();
});

test('a merged file row shows its owner', () => {
    render(FileList, {
        props: {
            files: [
                {
                    email: FIRST,
                    fileHash: 'a'.repeat(64),
                    fileId: 'a'.repeat(64),
                    name: 'proof.bin',
                    folder: '',
                    at: 1,
                    chunkCount: 1,
                    chunks: [
                        {
                            email: FIRST,
                            fileHash: 'a'.repeat(64),
                            fileId: 'a'.repeat(64),
                            chunkIndex: 0,
                            isLast: true,
                            originalName: 'proof.bin',
                            size: 4,
                            at: 1,
                            mediaKey: 'proof',
                            sha1: 'b'.repeat(40)
                        }
                    ],
                    duplicates: [],
                    complete: true
                }
            ],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            showOwner: true,
            ondownload: vi.fn(),
            ondelete: vi.fn()
        }
    });

    expect(screen.getByText(FIRST)).toBeTruthy();
});
