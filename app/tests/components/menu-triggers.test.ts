// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { FileGroup, FolderEntry, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import FileList from '#components/FileList.svelte';
import FileCard from '#components/FileCard.svelte';
import FolderTiles from '#components/FolderTiles.svelte';

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
});

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: '',
        size: 4,
        at: 1,
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
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

const folder: FolderEntry = { path: 'A', name: 'A', files: 1, subfolders: 0 };

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('right-clicking a file row opens the menu at the pointer', async () => {
    const onmenu = vi.fn();
    const item = file();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            onmenu
        }
    });

    const row = screen.getByText('proof.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });

    expect(onmenu).toHaveBeenCalledWith(item, { x: 120, y: 80 });
});

test('the row More button and keyboard context key open the menu', async () => {
    const onmenu = vi.fn();
    render(FileList, {
        props: {
            files: [file()],
            sort: FileSort.NameAscending,
            disabled: false,
            onmenu
        }
    });

    const more = screen.getByRole('button', { name: 'More actions for proof.bin' });
    await fireEvent.click(more);
    expect(onmenu).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'proof.bin' }), more);

    await fireEvent.keyDown(more, { key: 'ContextMenu' });
    expect(onmenu).toHaveBeenCalledTimes(2);
    await fireEvent.keyDown(more, { key: 'F10', shiftKey: true });
    expect(onmenu).toHaveBeenCalledTimes(3);
});

test('right-clicking a file card and its More button both open the menu', async () => {
    const onmenu = vi.fn();
    render(FileCard, {
        props: { item: file(), disabled: false, onmenu }
    });

    const card = screen.getByRole('group', { name: 'proof.bin' });
    await fireEvent.contextMenu(card, { clientX: 20, clientY: 30 });
    expect(onmenu).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'proof.bin' }), {
        x: 20,
        y: 30
    });

    const more = screen.getByRole('button', { name: 'More actions for proof.bin' });
    await fireEvent.click(more);
    expect(onmenu).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'proof.bin' }), more);
});

test('folder tiles open from the tile and expose a separate More button', async () => {
    const onopen = vi.fn();
    const onmenu = vi.fn();
    render(FolderTiles, {
        props: {
            folders: [folder],
            disabled: false,
            dragging: false,
            onopen,
            onmenu,
            ondropfiles: vi.fn()
        }
    });

    const open = screen.getByRole('button', { name: 'Open folder A' });
    await fireEvent.click(open);
    expect(onopen).toHaveBeenCalledWith('A');

    const more = screen.getByRole('button', { name: 'More actions for folder A' });
    expect(more).not.toBe(open);
    await fireEvent.click(more);
    expect(onmenu).toHaveBeenLastCalledWith(folder, more);

    await fireEvent.contextMenu(open, { clientX: 9, clientY: 11 });
    expect(onmenu).toHaveBeenLastCalledWith(folder, { x: 9, y: 11 });
});

test('a folder tile accepts a dragged file drop', async () => {
    const ondropfiles = vi.fn();
    render(FolderTiles, {
        props: {
            folders: [folder],
            disabled: false,
            dragging: true,
            onopen: vi.fn(),
            onmenu: vi.fn(),
            ondropfiles
        }
    });
    const tile = screen.getByRole('button', { name: 'Open folder A' }).closest('li');
    if (!tile) throw new Error('Expected a folder tile');

    await fireEvent.dragOver(tile);
    expect(tile.classList.contains('drop-target')).toBe(true);
    await fireEvent.drop(tile);

    expect(ondropfiles).toHaveBeenCalledWith(folder);
    expect(tile.classList.contains('drop-target')).toBe(false);
});

test('disabled entries cannot open their menus', async () => {
    const onmenu = vi.fn();
    render(FileList, {
        props: {
            files: [file()],
            sort: FileSort.NameAscending,
            disabled: true,
            onmenu
        }
    });

    const more = screen.getByRole('button', {
        name: 'More actions for proof.bin'
    }) as HTMLButtonElement;
    expect(more.disabled).toBe(true);
    await fireEvent.click(more);
    await fireEvent.keyDown(more, { key: 'ContextMenu' });

    expect(onmenu).not.toHaveBeenCalled();
});
