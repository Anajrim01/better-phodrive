// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import FileList from '#components/FileList.svelte';
import FileCard from '#components/FileCard.svelte';
import { file, selectionCallbacks } from './file-fixtures';

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

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('double-clicking a list row opens its preview with the row as the trigger', async () => {
    const item = file({ name: 'photo.png' });
    const onopenpreview = vi.fn();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const row = screen.getByText('photo.png').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.doubleClick(row);

    expect(onopenpreview).toHaveBeenCalledWith(item, row);
});

test('double-clicking a card opens its preview with the card as the trigger', async () => {
    const item = file({ name: 'photo.png' });
    const onopenpreview = vi.fn();
    const view = render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.doubleClick(shell);

    expect(onopenpreview).toHaveBeenCalledWith(item, shell);
});

test('double-clicking an action does not open a preview', async () => {
    const onopenpreview = vi.fn();
    const view = render(FileList, {
        props: {
            files: [file({ name: 'photo.png' })],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const button = view.container.querySelector('button');
    if (!button) throw new Error('Expected an action');
    await fireEvent.doubleClick(button);

    expect(onopenpreview).not.toHaveBeenCalled();
});

test('an incomplete file still opens the fallback preview', async () => {
    const item = file({ name: 'photo.png', complete: false, chunkCount: 2 });
    const onopenpreview = vi.fn();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...selectionCallbacks(),
            onopenpreview
        }
    });

    const row = screen.getByText('photo.png').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.doubleClick(row);

    expect(onopenpreview).toHaveBeenCalledWith(item, row);
});
