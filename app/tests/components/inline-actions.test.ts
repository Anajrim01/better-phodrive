// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import FileList from '#components/FileList.svelte';
import FileCard from '#components/FileCard.svelte';
import TrashView from '#components/TrashView.svelte';

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

const callbacks = () => ({
    ondownload: vi.fn(),
    ondelete: vi.fn(),
    onrestore: vi.fn(),
    ondeleteforever: vi.fn(),
    onmenu: vi.fn()
});

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a complete file row keeps one-click download and delete beside More', async () => {
    const props = callbacks();
    const view = render(FileList, {
        props: {
            files: [file()],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...props
        }
    });

    expect(view.container.querySelector('.inline-actions')).not.toBeNull();

    const download = screen.getByRole('button', { name: 'Download proof.bin' });
    const remove = screen.getByRole('button', { name: 'Delete proof.bin' });
    expect(screen.getByRole('button', { name: 'More actions for proof.bin' })).toBeTruthy();

    await fireEvent.click(download);
    await fireEvent.click(remove);

    expect(props.ondownload).toHaveBeenCalledTimes(1);
    expect(props.ondelete).toHaveBeenCalledTimes(1);
});

test('an incomplete row still checks the rest before offering quick actions', () => {
    const props = callbacks();
    render(FileList, {
        props: {
            files: [file({ complete: false, chunkCount: 2, chunks: [chunk({ isLast: false })] })],
            sort: FileSort.NameAscending,
            disabled: false,
            partial: true,
            action: null,
            ...props
        }
    });

    expect(screen.getByText('Load more to check the rest of this file.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download proof.bin' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More actions for proof.bin' })).toBeTruthy();
});

test('a partially trashed file offers Restore and Delete remaining chunks', async () => {
    const props = callbacks();
    render(FileList, {
        props: {
            files: [
                file({
                    complete: false,
                    chunkCount: 2,
                    chunks: [chunk({ isLast: false })],
                    trashedChunks: [chunk({ chunkIndex: 1, mediaKey: 'trash-1', trashedAt: 1 })]
                })
            ],
            sort: FileSort.NameAscending,
            disabled: false,
            partial: false,
            action: null,
            ...props
        }
    });

    expect(screen.getByRole('button', { name: 'Restore proof.bin' })).toBeTruthy();
    expect(
        screen.getByRole('button', { name: 'Delete remaining chunks of proof.bin' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More actions for proof.bin' })).toBeTruthy();
});

test('a trash row keeps Restore and Delete forever beside More', async () => {
    const props = callbacks();
    render(FileList, {
        props: {
            files: [file({ trashed: true, trashedChunks: [chunk({ trashedAt: 1 })] })],
            sort: FileSort.NameAscending,
            disabled: false,
            trash: true,
            action: null,
            ...props
        }
    });

    const restore = screen.getByRole('button', { name: 'Restore proof.bin' });
    const remove = screen.getByRole('button', { name: 'Delete proof.bin forever' });
    expect(screen.getByRole('button', { name: 'More actions for proof.bin' })).toBeTruthy();

    await fireEvent.click(restore);
    await fireEvent.click(remove);

    expect(props.onrestore).toHaveBeenCalledTimes(1);
    expect(props.ondeleteforever).toHaveBeenCalledTimes(1);
});

test('the trash view threads inline restore and delete forever', async () => {
    const props = callbacks();
    render(TrashView, {
        props: {
            files: [file({ trashed: true, trashedChunks: [chunk({ trashedAt: 1 })] })],
            sort: FileSort.NameAscending,
            disabled: false,
            loading: false,
            loadFailed: false,
            hasMore: false,
            action: null,
            ...props,
            onmore: vi.fn()
        }
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Restore proof.bin' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete proof.bin forever' }));

    expect(props.onrestore).toHaveBeenCalledTimes(1);
    expect(props.ondeleteforever).toHaveBeenCalledTimes(1);
});

test('a file card keeps quick actions in a wrapper the narrow layout can hide', async () => {
    const props = callbacks();
    const view = render(FileCard, {
        props: {
            item: file(),
            disabled: false,
            working: null,
            ...props
        }
    });

    expect(view.container.querySelector('.card-inline-actions')).not.toBeNull();
    const download = screen.getByRole('button', { name: 'Download' });
    await fireEvent.click(download);

    expect(props.ondownload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'More actions for proof.bin' })).toBeTruthy();
});
