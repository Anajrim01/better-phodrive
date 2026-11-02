// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
import FileCard from '#components/FileCard.svelte';
import FileList from '#components/FileList.svelte';
import FolderTiles from '#components/FolderTiles.svelte';
import { file, selectionCallbacks } from './file-fixtures';

const folder: FolderEntry = { path: 'A', name: 'A', files: 1, subfolders: 0 };

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('folders still open while uploads disable actions', async () => {
    const onopen = vi.fn();
    render(FolderTiles, {
        props: {
            folders: [folder],
            actionsDisabled: true,
            browseDisabled: false,
            dragging: false,
            onopen,
            onmenu: vi.fn(),
            ondropfiles: vi.fn()
        }
    });

    const open = screen.getByRole('button', {
        name: 'Open folder A'
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);

    await fireEvent.click(open);

    expect(onopen).toHaveBeenCalledWith('A');
    expect(
        (
            screen.getByRole('button', {
                name: 'More actions for A'
            }) as HTMLButtonElement
        ).disabled
    ).toBe(true);
});

test('folders stay closed while the library is loading', async () => {
    const onopen = vi.fn();
    render(FolderTiles, {
        props: {
            folders: [folder],
            actionsDisabled: false,
            browseDisabled: true,
            dragging: false,
            onopen,
            onmenu: vi.fn(),
            ondropfiles: vi.fn()
        }
    });

    const open = screen.getByRole('button', {
        name: 'Open folder A'
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
});

test('a file preview still opens while uploads disable actions', async () => {
    const item = file({ name: 'photo.png' });
    const onopenpreview = vi.fn();
    const view = render(FileCard, {
        props: {
            item,
            actionsDisabled: true,
            browseDisabled: false,
            working: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.doubleClick(shell);

    expect(onopenpreview).toHaveBeenCalledWith(item, shell);
    expect(
        (
            screen.getByRole('checkbox', {
                name: 'Select photo.png'
            }) as HTMLInputElement
        ).disabled
    ).toBe(false);
});

test('a file preview stays closed while the library is loading', async () => {
    const onopenpreview = vi.fn();
    const view = render(FileCard, {
        props: {
            item: file({ name: 'photo.png' }),
            actionsDisabled: false,
            browseDisabled: true,
            working: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.doubleClick(shell);
    await fireEvent.keyDown(shell, { key: 'Enter' });

    expect(onopenpreview).not.toHaveBeenCalled();
});

test('Enter opens a card preview while uploads disable actions', async () => {
    const item = file({ name: 'photo.png' });
    const onopenpreview = vi.fn();
    const view = render(FileCard, {
        props: {
            item,
            actionsDisabled: true,
            browseDisabled: false,
            working: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.keyDown(shell, { key: 'Enter' });

    expect(onopenpreview).toHaveBeenCalledWith(item, shell);
});

test('Enter opens a list row preview while uploads disable actions', async () => {
    const item = file({ name: 'photo.png' });
    const onopenpreview = vi.fn();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            actionsDisabled: true,
            browseDisabled: false,
            action: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const row = screen.getByText('photo.png').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.keyDown(row, { key: 'Enter' });

    expect(onopenpreview).toHaveBeenCalledWith(item, row);
});

test('destructive card actions stay disabled while uploads run', async () => {
    const item = file({ name: 'photo.png' });
    const onstartdrag = vi.fn();
    const view = render(FileCard, {
        props: {
            item,
            actionsDisabled: true,
            browseDisabled: false,
            working: null,
            onstartdrag,
            ...selectionCallbacks()
        }
    });

    const download = screen.getByRole('button', {
        name: 'Download photo.png'
    }) as HTMLButtonElement;
    const remove = screen.getByRole('button', {
        name: 'Delete photo.png'
    }) as HTMLButtonElement;
    const more = screen.getByRole('button', {
        name: 'More actions for photo.png'
    }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(more.disabled).toBe(true);

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.dragStart(shell);

    expect(onstartdrag).not.toHaveBeenCalled();
});
