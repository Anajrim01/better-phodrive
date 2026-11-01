// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { Group } from '@madkarmaa/phodrive-core/models';
import FileList from '#components/FileList.svelte';
import GroupListingStatus from '#components/GroupListingStatus.svelte';
import UploadTarget from '#components/UploadTarget.svelte';

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

vi.hoisted(() => {
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
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    );
});

function group(): Group {
    return { id: 'family', name: 'Family', accounts: [FIRST, SECOND] };
}

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

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

test('a saved group that cannot shard explains the fallback', () => {
    render(UploadTarget, {
        props: {
            groups: [{ id: 'small', name: 'Small', accounts: [FIRST] }],
            value: '',
            currentEmail: FIRST,
            unavailable: 'Small',
            onchange: vi.fn()
        }
    });

    expect(
        screen.getByText('Small needs at least two connected accounts. Using the current account.')
    ).toBeTruthy();
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
            /Paused: second@example\.com \(\d+s\)\. Files from paused accounts stay hidden until they answer\./
        )
    ).toBeTruthy();
});

test('a partial bar names disconnected members separately', () => {
    render(GroupListingStatus, {
        props: {
            groupName: 'Family',
            total: 3,
            accounts: [
                { email: FIRST, status: 'ok' },
                {
                    email: SECOND,
                    status: 'error',
                    message: `${SECOND} is not connected.`
                }
            ]
        }
    });

    expect(
        screen.getByText(
            `Not connected: ${SECOND}. Their files stay hidden until they are added back.`
        )
    ).toBeTruthy();
});

test('a partial bar names failed members alongside paused ones', () => {
    render(GroupListingStatus, {
        props: {
            groupName: 'Family',
            total: 3,
            accounts: [
                { email: FIRST, status: 'ok' },
                { email: SECOND, status: 'error', message: 'Could not load files.' },
                { email: 'third@example.com', status: 'paused', retryAfterSeconds: 30 }
            ]
        }
    });

    expect(screen.getByText(/Paused: third@example\.com/)).toBeTruthy();
    expect(screen.getByText(`Could not load ${SECOND}. The list is partial.`)).toBeTruthy();
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
                    trashedChunks: [],
                    trashed: false,
                    trashedAt: null,
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
