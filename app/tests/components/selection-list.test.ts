// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import FileList from '#components/FileList.svelte';
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

test('every list row and the header expose a direct checkbox', () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    render(FileList, {
        props: {
            files: [first, second],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...selectionCallbacks()
        }
    });

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Select all files' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select first.bin' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Select second.bin' })).toBeTruthy();
});

test('the checkbox stays in the first cell so the file name keeps its own column', () => {
    const item = file({ name: 'proof.bin' });
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...selectionCallbacks()
        }
    });

    const row = screen.getByText('proof.bin').closest('tr');
    if (!row) throw new Error('Expected a row');

    expect(row.cells[0]?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(row.cells[1]?.textContent).toContain('proof.bin');
});

test('the header checkbox is indeterminate for a partial selection and checked for all', () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    const view = render(FileList, {
        props: {
            files: [first, second],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            selected: new Set([fileKey(first)]),
            ...selectionCallbacks()
        }
    });
    const header = screen.getByRole('checkbox', {
        name: 'Select all files'
    }) as HTMLInputElement;

    expect(header.indeterminate).toBe(true);
    expect(header.checked).toBe(false);

    view.rerender({
        files: [first, second],
        sort: FileSort.NameAscending,
        disabled: false,
        action: null,
        selected: new Set([fileKey(first), fileKey(second)]),
        ...selectionCallbacks()
    });

    const all = screen.getByRole('checkbox', {
        name: 'Select all files'
    }) as HTMLInputElement;
    expect(all.indeterminate).toBe(false);
    expect(all.checked).toBe(true);
});

test('the header checkbox requests select all and then clears the visible files', async () => {
    const item = file();
    const props = selectionCallbacks();
    const view = render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...props
        }
    });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files' }));
    expect(props.onselectall).toHaveBeenCalledWith(true);

    view.rerender({
        files: [item],
        sort: FileSort.NameAscending,
        disabled: false,
        action: null,
        selected: new Set([fileKey(item)]),
        ...props
    });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all files' }));
    expect(props.onselectall).toHaveBeenLastCalledWith(false);
});

test('a row checkbox reports its file and the click event', async () => {
    const item = file({ name: 'first.bin' });
    const props = selectionCallbacks();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...props
        }
    });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select first.bin' }));

    expect(props.onselect).toHaveBeenCalledTimes(1);
    expect(props.onselect.mock.calls[0]?.[0]).toBe(item);
});

test('Space on a focused row toggles it', async () => {
    const item = file({ name: 'first.bin' });
    const props = selectionCallbacks();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            ...props
        }
    });

    const row = screen.getByText('first.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.keyDown(row, { key: ' ' });

    expect(props.onselect).toHaveBeenCalledTimes(1);
});

test('right-clicking an unselected row selects only it and opens the single menu', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    const props = selectionCallbacks();
    render(FileList, {
        props: {
            files: [first, second],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            selected: new Set([fileKey(second)]),
            ...props
        }
    });

    const row = screen.getByText('first.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    expect(props.oncontextselect).toHaveBeenCalledWith(first);
    expect(props.onmenu).toHaveBeenCalledWith(first, { x: 10, y: 20 });
    expect(props.onselectionmenu).not.toHaveBeenCalled();
});

test('right-clicking one of several selected rows opens the bulk menu', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    const props = selectionCallbacks();
    render(FileList, {
        props: {
            files: [first, second],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            selected: new Set([fileKey(first), fileKey(second)]),
            ...props
        }
    });

    const row = screen.getByText('first.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    expect(props.onselectionmenu).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(props.onmenu).not.toHaveBeenCalled();
    expect(props.oncontextselect).not.toHaveBeenCalled();
});

test('a single selected row still opens its own menu', async () => {
    const item = file({ name: 'first.bin' });
    const props = selectionCallbacks();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            selected: new Set([fileKey(item)]),
            ...props
        }
    });

    const row = screen.getByText('first.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 20 });

    expect(props.onmenu).toHaveBeenCalledWith(item, { x: 10, y: 20 });
    expect(props.onselectionmenu).not.toHaveBeenCalled();
});
