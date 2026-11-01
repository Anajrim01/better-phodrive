// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FileGroup, FolderEntry, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import RenameDialog from '#components/RenameDialog.svelte';
import MoveDialog from '#components/MoveDialog.svelte';
import DetailsDialog from '#components/DetailsDialog.svelte';
import DeleteFolderDialog from '#components/DeleteFolderDialog.svelte';

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
    Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.setAttribute('open', '');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'open' });
            this.dispatchEvent(event);
        }
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
        configurable: true,
        value: function (this: HTMLDialogElement) {
            this.removeAttribute('open');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'closed' });
            this.dispatchEvent(event);
        }
    });
});

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: 'Reports',
        size: 4,
        at: 1_700_000_000_000,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'proof.bin',
        folder: 'Reports',
        at: 1_700_000_000_000,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

const folder: FolderEntry = { path: 'Reports', name: 'Reports', files: 2, subfolders: 1 };

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('the rename dialog says the change is Phodrive-only and submits a new name', async () => {
    const onrename = vi.fn();
    render(RenameDialog, {
        props: {
            open: true,
            target: { kind: 'file', item: file() },
            busy: false,
            onrename,
            onclose: vi.fn()
        }
    });

    expect(
        screen.getByText(
            'This renames the file in Phodrive only. The file in Google Photos is unchanged.'
        )
    ).toBeTruthy();
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('proof.bin');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(input, { target: { value: 'renamed.bin' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onrename).toHaveBeenCalledWith('renamed.bin');
});

test('the rename dialog validates names and shows server errors', async () => {
    render(RenameDialog, {
        props: {
            open: true,
            target: { kind: 'folder', entry: folder },
            error: 'A folder with that name already exists here.',
            busy: false,
            onrename: vi.fn(),
            onclose: vi.fn()
        }
    });

    expect(
        screen.getByText(
            'This renames the folder in Phodrive only. Google Photos files are not renamed.'
        )
    ).toBeTruthy();
    expect(screen.getByText('A folder with that name already exists here.')).toBeTruthy();
    const input = document.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'bad/name' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
});

test('the move dialog says the change is Phodrive-only and lists folder destinations', () => {
    render(MoveDialog, {
        props: {
            open: true,
            target: { kind: 'file', item: file() },
            destinations: [
                { value: '', label: 'My files' },
                { value: 'Reports', label: 'Reports' },
                { value: 'Reports/2026', label: 'Reports/2026' }
            ],
            value: 'Reports',
            busy: false,
            onmove: vi.fn(),
            onclose: vi.fn()
        }
    });

    expect(
        screen.getByText(
            'This moves the file in Phodrive only. Google Photos albums are unchanged.'
        )
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true);
});

test('file details show the listing name, location, owner, size, and status', () => {
    render(DetailsDialog, {
        props: {
            open: true,
            target: { kind: 'file', item: file() },
            files: [file()],
            owners: ['owner@example.com'],
            onclose: vi.fn()
        }
    });

    expect(screen.getByText('proof.bin')).toBeTruthy();
    expect(screen.getByText('Reports')).toBeTruthy();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('4 B')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
});

test('folder details show direct files, subfolders, total files, and owners', () => {
    render(DetailsDialog, {
        props: {
            open: true,
            target: { kind: 'folder', entry: folder },
            files: [file(), file({ fileId: 'c'.repeat(64), folder: 'Reports/2026' })],
            owners: ['owner@example.com', 'second@example.com'],
            onclose: vi.fn()
        }
    });

    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getByText('owner@example.com, second@example.com')).toBeTruthy();
});

test('folder delete warns about the count, Trash, and confirms', async () => {
    const ondelete = vi.fn();
    render(DeleteFolderDialog, {
        props: {
            open: true,
            folder,
            count: 2,
            busy: false,
            ondelete,
            onclose: vi.fn()
        }
    });

    expect(
        screen.getByText(
            'Reports and 2 loaded files will move to Google Photos trash. Every file under the folder is included, and you can restore them from Trash.'
        )
    ).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(ondelete).toHaveBeenCalled();
});

test('an empty folder delete cannot be confirmed', () => {
    render(DeleteFolderDialog, {
        props: {
            open: true,
            folder,
            count: 0,
            busy: false,
            ondelete: vi.fn(),
            onclose: vi.fn()
        }
    });

    expect(
        (screen.getByRole('button', { name: 'Move to trash' }) as HTMLButtonElement).disabled
    ).toBe(true);
});
