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

test('dragging from row controls does not start a file drag', async () => {
    const item = file({ name: 'first.bin' });
    const onstartdrag = vi.fn();
    render(FileList, {
        props: {
            files: [item],
            sort: FileSort.NameAscending,
            disabled: false,
            action: null,
            onstartdrag,
            ...selectionCallbacks()
        }
    });
    const row = screen.getByText('first.bin').closest('tr');
    if (!row) throw new Error('Expected a row');

    await fireEvent.dragStart(screen.getByRole('checkbox', { name: 'Select first.bin' }));
    await fireEvent.dragStart(screen.getByRole('button', { name: 'Download first.bin' }));
    await fireEvent.dragStart(screen.getByRole('button', { name: 'More actions for first.bin' }));

    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(screen.getByRole('checkbox', { name: 'Select first.bin' }));
    await fireEvent.dragStart(row);
    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Download first.bin' }));
    await fireEvent.dragStart(row);
    expect(onstartdrag).not.toHaveBeenCalled();

    await fireEvent.pointerDown(row);
    await fireEvent.dragStart(row);
    expect(onstartdrag).toHaveBeenCalledTimes(1);
});

test('clicking a row tooltip keeps a multi selection', async () => {
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
    const tooltip = document.createElement('span');
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = 'Download first.bin';
    row.append(tooltip);

    await fireEvent.click(tooltip);

    expect(props.onselect).not.toHaveBeenCalled();
    expect(
        (screen.getByRole('checkbox', { name: 'Select first.bin' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
        (screen.getByRole('checkbox', { name: 'Select second.bin' }) as HTMLInputElement).checked
    ).toBe(true);
});
