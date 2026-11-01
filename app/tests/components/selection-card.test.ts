// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import FileCard from '#components/FileCard.svelte';
import TrashView from '#components/TrashView.svelte';
import { chunk, file, selectionCallbacks } from './file-fixtures';

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

test('a card exposes a direct checkbox next to its name', async () => {
    const item = file({ name: 'card.bin' });
    const props = selectionCallbacks();
    render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: true,
            selectedCount: 2,
            ...props
        }
    });

    const checkbox = screen.getByRole('checkbox', {
        name: 'Select card.bin'
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    await fireEvent.click(checkbox);
    expect(props.onselect).toHaveBeenCalledTimes(1);
    expect(props.onselect.mock.calls[0]?.[2]).toBe('toggle');
});

test('clicking the card body sends a point gesture and actions do not', async () => {
    const item = file({ name: 'card.bin' });
    const props = selectionCallbacks();
    render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: false,
            ...props
        }
    });
    const card = screen.getByRole('group', { name: 'card.bin' });

    await fireEvent.click(card);
    expect(props.onselect).toHaveBeenLastCalledWith(item, expect.any(MouseEvent), 'point');

    await fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onselect).toHaveBeenCalledTimes(1);
});

test('clicking a card tooltip keeps a multi selection', async () => {
    const item = file({ name: 'card.bin' });
    const props = selectionCallbacks();
    render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: true,
            selectedCount: 2,
            ...props
        }
    });
    const card = screen.getByRole('group', { name: 'card.bin' });
    const tooltip = document.createElement('span');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = 'Download card.bin';
    card.append(tooltip);

    await fireEvent.click(tooltip);

    expect(props.onselect).not.toHaveBeenCalled();
    expect(
        (screen.getByRole('checkbox', { name: 'Select card.bin' }) as HTMLInputElement).checked
    ).toBe(true);
});

test('dragging from card controls does not start a file drag', async () => {
    const item = file({ name: 'card.bin' });
    const onstartdrag = vi.fn();
    render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: false,
            onstartdrag,
            ...selectionCallbacks()
        }
    });
    const card = screen.getByRole('group', { name: 'card.bin' });

    await fireEvent.dragStart(screen.getByRole('checkbox', { name: 'Select card.bin' }));
    await fireEvent.dragStart(screen.getByRole('button', { name: 'Download' }));
    await fireEvent.dragStart(screen.getByRole('button', { name: 'More actions for card.bin' }));

    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'Select card.bin' }));
    await fireEvent.dragStart(card);
    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Download' }));
    await fireEvent.dragStart(card);
    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(card);
    await fireEvent.dragStart(card);
    expect(onstartdrag).toHaveBeenCalledTimes(1);
});

test('the card checkbox is hidden at rest and shown when selected', () => {
    const item = file({ name: 'card.bin' });
    const props = selectionCallbacks();
    const view = render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: true,
            ...props
        }
    });
    const checkbox = view.container.querySelector('.np-checkbox-container.card-select');

    if (!checkbox) throw new Error('Expected a card select checkbox');
    expect(getComputedStyle(checkbox).opacity).toBe('1');
});

test('right-clicking a selected card in a multi selection opens the bulk menu', async () => {
    const item = file({ name: 'card.bin' });
    const props = selectionCallbacks();
    render(FileCard, {
        props: {
            item,
            disabled: false,
            working: null,
            selected: true,
            selectedCount: 2,
            ...props
        }
    });

    const card = screen.getByRole('group', { name: 'card.bin' });
    await fireEvent.contextMenu(card, { clientX: 4, clientY: 6 });

    expect(props.onselectionmenu).toHaveBeenCalledWith({ x: 4, y: 6 });
    expect(props.onmenu).not.toHaveBeenCalled();
});

test('Trash keeps a checkbox on every row and threads the same selection', () => {
    const item = file({
        name: 'old.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const props = selectionCallbacks();
    render(TrashView, {
        props: {
            files: [item],
            sort: FileSort.ModifiedDescending,
            disabled: false,
            loading: false,
            loadFailed: false,
            hasMore: false,
            action: null,
            selected: new Set([fileKey(item)]),
            ...props,
            onmore: vi.fn()
        }
    });

    const checkbox = screen.getByRole('checkbox', {
        name: 'Select old.bin'
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Select all files' })).toBeTruthy();
});
