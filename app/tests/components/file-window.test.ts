// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import FileGrid from '#components/FileGrid.svelte';
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
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
        configurable: true,
        value: () => {}
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
        configurable: true,
        value: () => {}
    });
});

let scrollPosition = 0;
Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollPosition,
    set: (value: number) => {
        scrollPosition = value;
    }
});

beforeEach(() => {
    scrollPosition = 0;
    cleanup();
});
afterEach(() => cleanup());

function manyFiles(count: number): FileGroup[] {
    return Array.from({ length: count }, (_, index) =>
        file({
            fileId: index.toString(16).padStart(64, '0'),
            name: `file-${index}.bin`
        })
    );
}

async function scrollTo(position: number): Promise<void> {
    scrollPosition = position;
    window.dispatchEvent(new Event('scroll'));
    await tick();
    await tick();
}

function listProps(files: FileGroup[], overrides: Record<string, unknown> = {}) {
    return {
        files,
        sort: FileSort.NameAscending,
        actionsDisabled: false,
        action: null,
        ...selectionCallbacks(),
        ...overrides
    };
}

function gridProps(files: FileGroup[], overrides: Record<string, unknown> = {}) {
    return {
        files,
        folders: [],
        layout: FileLayout.Grid,
        sort: FileSort.NameAscending,
        loading: false,
        loadFailed: false,
        filtered: false,
        hasFiles: true,
        hasMore: false,
        actionsDisabled: false,
        showFolder: false,
        selected: new Set<string>(),
        onmovefiles: vi.fn(),
        dragging: false,
        onstartdrag: vi.fn(),
        onenddrag: vi.fn(),
        onopenfolder: vi.fn(),
        onfilemenu: vi.fn(),
        onfoldermenu: vi.fn(),
        onmore: vi.fn(),
        ...selectionCallbacks(),
        ...overrides
    };
}

test('the list mounts only a window of rows and follows the page scroll', async () => {
    const files = manyFiles(500);
    render(FileList, { props: listProps(files) });

    const initialRows = document.querySelectorAll('tr[data-index]').length;
    expect(initialRows).toBeGreaterThan(5);
    expect(initialRows).toBeLessThan(60);
    expect(document.querySelector('tr[data-index]')?.getAttribute('aria-rowindex')).toBe('2');
    expect(screen.getByText('file-0.bin')).toBeTruthy();
    expect(screen.queryByText('file-400.bin')).toBeNull();

    await scrollTo(400 * 48);

    expect(screen.getByText('file-400.bin')).toBeTruthy();
    expect(screen.queryByText('file-0.bin')).toBeNull();
    expect(document.querySelectorAll('tr[data-index]').length).toBeLessThan(60);
});

test('a selected list row stays checked after scrolling it into view', async () => {
    const files = manyFiles(500);
    const selected = new Set([fileKey(files[300]!)]);
    render(FileList, { props: listProps(files, { selected }) });

    await scrollTo(300 * 48);

    const checkbox = screen.getByRole('checkbox', {
        name: 'Select file-300.bin'
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
});

test('select all still covers every visible file from the header', async () => {
    const files = manyFiles(500);
    const props = listProps(files);
    render(FileList, { props });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all visible files' }));

    expect(props.onselectall).toHaveBeenCalledWith(true);
    expect(document.querySelectorAll('tr[data-index]').length).toBeLessThan(60);
});

test('the grid mounts only a window of cards and follows the page scroll', async () => {
    const files = manyFiles(500);
    const selected = new Set([fileKey(files[100]!)]);
    render(FileGrid, { props: gridProps(files, { selected }) });

    const initialCards = document.querySelectorAll('[data-file-key]').length;
    expect(initialCards).toBeGreaterThan(0);
    expect(initialCards).toBeLessThan(60);
    const firstCard = document.querySelector('[data-file-key]')?.closest('li');
    expect(firstCard?.getAttribute('aria-posinset')).toBe('1');
    expect(firstCard?.getAttribute('aria-setsize')).toBe('500');

    await scrollTo(100 * 262);

    expect(document.querySelector(`[data-file-key="${fileKey(files[0]!)}"]`)).toBeNull();
    expect(document.querySelector(`[data-file-key="${fileKey(files[100]!)}"]`)).not.toBeNull();
    expect(
        (
            screen.getByRole('checkbox', {
                name: 'Select file-100.bin'
            }) as HTMLInputElement
        ).checked
    ).toBe(true);
});

test('a dragged list row stays mounted outside the visible window', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files, { layout: FileLayout.List }) });

    const row = screen.getByText('file-0.bin').closest('tr');
    if (!row) throw new Error('Expected a row');
    await fireEvent.dragStart(row);
    await scrollTo(400 * 48);

    expect(screen.getByText('file-0.bin')).toBeTruthy();
    const indexes = [...document.querySelectorAll('tr[data-index]')].map((row) =>
        Number((row as HTMLElement).dataset.index)
    );
    const next = indexes.find((index) => index > 0);
    if (next === undefined) throw new Error('Expected a follow-up row');
    const spacerHeights = [...document.querySelectorAll('tr.spacer td')].map(
        (cell) => (cell as HTMLElement).style.height
    );
    expect(spacerHeights).toContain(`${(next - 1) * 48}px`);

    await fireEvent.dragEnd(row);
    await tick();

    expect(screen.queryByText('file-0.bin')).toBeNull();
});

test('a dragged grid row stays mounted outside the visible window', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files) });

    const card = screen.getByRole('group', { name: 'file-0.bin' });
    await fireEvent.dragStart(card);
    await scrollTo(100 * 262);

    expect(document.querySelector(`[data-file-key="${fileKey(files[0]!)}"]`)).not.toBeNull();

    await fireEvent.dragEnd(card);
    await tick();

    expect(document.querySelector(`[data-file-key="${fileKey(files[0]!)}"]`)).toBeNull();
});

test('arrow keys move focus between grid cards', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files) });

    const first = screen.getByRole('group', { name: 'file-0.bin' });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    await tick();

    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'file-1.bin' }));
});

test('arrow keys move focus between list rows', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files, { layout: FileLayout.List }) });

    const first = screen.getByText('file-0.bin').closest('tr');
    if (!first) throw new Error('Expected a row');
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowDown' });
    await tick();

    expect(document.activeElement).toBe(screen.getByText('file-1.bin').closest('tr'));
});
