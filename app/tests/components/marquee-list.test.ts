// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import FileGrid from '#components/FileGrid.svelte';
import TrashView from '#components/TrashView.svelte';
import { chunk, domRect, file } from './file-fixtures';

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

const first = file({ name: 'first.bin', fileId: 'a'.repeat(64) });
const second = file({ name: 'second.bin', fileId: 'b'.repeat(64) });

const callbacks = () => ({
    onopenfolder: vi.fn(),
    ondownload: vi.fn(),
    ondelete: vi.fn(),
    onrestore: vi.fn(),
    onfilemenu: vi.fn(),
    onfoldermenu: vi.fn(),
    onmore: vi.fn()
});

function mountList(selected = new Set<string>()) {
    const onmarquee = vi.fn();
    const view = render(FileGrid, {
        props: {
            files: [first, second],
            folders: [],
            layout: FileLayout.List,
            sort: FileSort.NameAscending,
            loading: false,
            loadFailed: false,
            filtered: false,
            hasFiles: true,
            hasMore: false,
            disabled: false,
            showFolder: false,
            selected,
            onmarquee,
            onmovefiles: vi.fn(),
            dragging: false,
            onstartdrag: vi.fn(),
            onenddrag: vi.fn(),
            ...callbacks()
        }
    });
    const rows = view.container.querySelectorAll('tbody tr');
    Object.defineProperty(rows[0], 'getBoundingClientRect', {
        value: () => domRect(0, 100, 400, 140)
    });
    Object.defineProperty(rows[1], 'getBoundingClientRect', {
        value: () => domRect(0, 150, 400, 190)
    });
    const surface = view.container.querySelector('section');
    if (!surface) throw new Error('Expected a grid surface');

    return { onmarquee, surface, rows, container: view.container };
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a list drag selects intersecting rows and replaces the previous selection', async () => {
    const { onmarquee, surface } = mountList(new Set([fileKey(second)]));

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerUp(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(first)]));
});

test('Ctrl-drag adds intersecting rows to the previous selection', async () => {
    const { onmarquee, surface } = mountList(new Set([fileKey(second)]));

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        ctrlKey: true
    });
    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(second), fileKey(first)]));
});

test('Escape cancels a list drag and restores the pre-drag selection', async () => {
    const { onmarquee, surface } = mountList(new Set([fileKey(second)]));

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });
    window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(second)]));
});

test('a click under the 4px threshold clears the selection without a marquee', async () => {
    const { onmarquee, surface } = mountList();

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 2,
        clientY: 91,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerUp(surface, {
        clientX: 2,
        clientY: 91,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set());
});

test('Alt-drag over a full list row starts a marquee', async () => {
    const { onmarquee, rows } = mountList();

    await fireEvent.pointerDown(rows[0], {
        clientX: 0,
        clientY: 100,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        altKey: true
    });
    await fireEvent.pointerMove(rows[0], {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse',
        altKey: true
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(first)]));
});

test('a plain drag on a row does not start a marquee', async () => {
    const { onmarquee, rows } = mountList();

    await fireEvent.pointerDown(rows[0], {
        clientX: 0,
        clientY: 100,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(rows[0], {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).not.toHaveBeenCalled();
});

test('a touch pointer does not start a marquee', async () => {
    const { onmarquee, surface } = mountList();

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'touch'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'touch'
    });

    expect(onmarquee).not.toHaveBeenCalled();
});

test('the Trash list uses the same marquee selection', async () => {
    const onmarquee = vi.fn();
    const firstTrash = file({
        name: 'old.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const secondTrash = file({
        fileId: 'b'.repeat(64),
        name: 'older.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const view = render(TrashView, {
        props: {
            files: [firstTrash, secondTrash],
            sort: FileSort.NameAscending,
            disabled: false,
            loading: false,
            loadFailed: false,
            hasMore: false,
            action: null,
            selected: new Set<string>(),
            onmarquee,
            onrestore: vi.fn(),
            ondeleteforever: vi.fn(),
            onmenu: vi.fn(),
            onmore: vi.fn()
        }
    });
    const rows = view.container.querySelectorAll('tbody tr');
    Object.defineProperty(rows[0], 'getBoundingClientRect', {
        value: () => domRect(0, 100, 400, 140)
    });
    Object.defineProperty(rows[1], 'getBoundingClientRect', {
        value: () => domRect(0, 150, 400, 190)
    });
    const surface = view.container.querySelector('.marquee-surface');
    if (!surface) throw new Error('Expected a Trash marquee surface');

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 90,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 135,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(firstTrash)]));
});
