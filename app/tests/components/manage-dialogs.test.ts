// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FileGroup, FolderEntry, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import RenameDialog from '#components/RenameDialog.svelte';
import MoveDialog from '#components/MoveDialog.svelte';
import DetailsDialog from '#components/DetailsDialog.svelte';
import DeleteFolderDialog from '#components/DeleteFolderDialog.svelte';
import ConfirmDialog from '#components/ConfirmDialog.svelte';

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
            'Only the Phodrive file name changes. The file in Google Photos keeps its name.'
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
            'Only the Phodrive folder name changes. The Google Photos album keeps its name.'
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
        screen.getByText('Only the Phodrive file moves. The Google Photos album is unchanged.')
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
            'This moves every file under Reports to Google Photos trash, including 2 loaded files. You can restore them from Trash.'
        )
    ).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(ondelete).toHaveBeenCalled();
});

test('bulk details summarise the selection with size, owners, and incomplete count', () => {
    const complete = file();
    const incomplete = file({
        fileId: 'c'.repeat(64),
        email: 'second@example.com',
        complete: false
    });
    render(DetailsDialog, {
        props: {
            open: true,
            target: null,
            files: [],
            owners: [],
            selection: [complete, incomplete],
            onclose: vi.fn()
        }
    });

    expect(screen.getByText('Total size')).toBeTruthy();
    expect(screen.getByText('4 B known')).toBeTruthy();
    expect(screen.getByText('owner@example.com, second@example.com')).toBeTruthy();
    expect(screen.getByText('Incomplete')).toBeTruthy();
});

test('a bulk move keeps the Move button available for My files and submits once', async () => {
    const onmove = vi.fn();
    render(MoveDialog, {
        props: {
            open: true,
            target: null,
            destinations: [
                { value: '', label: 'My files' },
                { value: 'Shared', label: 'Shared' }
            ],
            value: '',
            busy: false,
            headline: 'Move 3 files',
            note: 'This moves 3 files in Phodrive only. Google Photos albums are unchanged.',
            disableWhenUnchanged: false,
            onmove,
            onclose: vi.fn()
        }
    });

    expect(screen.getByText('Move 3 files')).toBeTruthy();
    expect(
        screen.getByText('This moves 3 files in Phodrive only. Google Photos albums are unchanged.')
    ).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Move' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    await fireEvent.click(submit);
    expect(onmove).toHaveBeenCalledWith('');
});

test('bulk delete confirms the count, Google Photos trash, and restore path', async () => {
    const onconfirm = vi.fn();
    render(ConfirmDialog, {
        props: {
            open: true,
            target: {
                kind: 'selection',
                files: [file(), file({ fileId: 'b'.repeat(64), complete: false })],
                permanent: false
            },
            onconfirm
        }
    });

    expect(screen.getByText('Move 2 files to trash?')).toBeTruthy();
    expect(
        screen.getByText(
            'This moves 2 files to Google Photos trash. You can restore them from Trash. For 1 incomplete file, only the remaining chunks move.'
        )
    ).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(onconfirm).toHaveBeenCalledTimes(1);
});

test('bulk delete forever warns that the user cannot undo it', async () => {
    const onconfirm = vi.fn();
    render(ConfirmDialog, {
        props: {
            open: true,
            target: {
                kind: 'selection',
                files: [file()],
                permanent: true
            },
            onconfirm
        }
    });

    expect(screen.getByText('Delete 1 file forever?')).toBeTruthy();
    expect(screen.getByText('This deletes 1 file forever. You cannot undo this.')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    expect(onconfirm).toHaveBeenCalledTimes(1);
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
