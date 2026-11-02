// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import FileGrid from '#components/FileGrid.svelte';
import { domRect, file } from './file-fixtures';

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

async function scrollTo(position: number): Promise<void> {
    scrollPosition = position;
    window.dispatchEvent(new Event('scroll'));
    await tick();
    await tick();
}

const first = file({ name: 'first.bin', fileId: 'a'.repeat(64) });
const second = file({ name: 'second.bin', fileId: 'b'.repeat(64) });

function mountGrid() {
    const onmarquee = vi.fn();
    const view = render(FileGrid, {
        props: {
            files: [first, second],
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
            onmarquee,
            onmovefiles: vi.fn(),
            dragging: false,
            onstartdrag: vi.fn(),
            onenddrag: vi.fn(),
            onopenfolder: vi.fn(),
            ondownload: vi.fn(),
            ondelete: vi.fn(),
            onrestore: vi.fn(),
            onfilemenu: vi.fn(),
            onfoldermenu: vi.fn(),
            onmore: vi.fn()
        }
    });
    const cards = view.container.querySelectorAll<HTMLElement>('[data-file-key]');
    Object.defineProperty(cards[0], 'getBoundingClientRect', {
        value: () => domRect(0, 100, 200, 300)
    });
    Object.defineProperty(cards[1], 'getBoundingClientRect', {
        value: () => domRect(220, 100, 420, 300)
    });
    const surface = view.container.querySelector('section');
    if (!surface) throw new Error('Expected a grid surface');

    return { onmarquee, surface, cards };
}

beforeEach(() => {
    scrollPosition = 0;
    cleanup();
});
afterEach(() => cleanup());

test('a grid drag selects intersecting cards', async () => {
    const { onmarquee, surface } = mountGrid();

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 80,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 210,
        clientY: 320,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerUp(surface, {
        clientX: 210,
        clientY: 320,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(first)]));
});

test('a grid drag ignores a pointer that starts on a card', async () => {
    const { onmarquee, cards } = mountGrid();

    await fireEvent.pointerDown(cards[0], {
        clientX: 10,
        clientY: 110,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(cards[0], {
        clientX: 300,
        clientY: 400,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).not.toHaveBeenCalled();
});

test('a marquee keeps earlier hits after scrolling unmounts them', async () => {
    const files = Array.from({ length: 100 }, (_, index) =>
        file({
            fileId: index.toString(16).padStart(64, '0'),
            name: `file-${index}.bin`
        })
    );
    const onmarquee = vi.fn();
    const view = render(FileGrid, {
        props: {
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
            onmarquee,
            onmovefiles: vi.fn(),
            dragging: false,
            onstartdrag: vi.fn(),
            onenddrag: vi.fn(),
            onopenfolder: vi.fn(),
            ondownload: vi.fn(),
            ondelete: vi.fn(),
            onrestore: vi.fn(),
            onfilemenu: vi.fn(),
            onfoldermenu: vi.fn(),
            onmore: vi.fn()
        }
    });
    const firstCard = view.container.querySelector<HTMLElement>('[data-file-key]');
    if (!firstCard) throw new Error('Expected a card');
    Object.defineProperty(firstCard, 'getBoundingClientRect', {
        value: () => domRect(0, 100, 200, 300)
    });
    const surface = view.container.querySelector('section');
    if (!surface) throw new Error('Expected a grid surface');

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 80,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 210,
        clientY: 320,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(files[0]!)]));

    await scrollTo(40 * 246);

    expect(view.container.querySelector(`[data-file-key="${fileKey(files[0]!)}"]`)).toBeNull();
    const nextCard = view.container.querySelector<HTMLElement>('[data-file-key]');
    if (!nextCard) throw new Error('Expected a card after scrolling');
    const nextKey = nextCard.dataset.fileKey;
    if (!nextKey) throw new Error('Expected a card key');
    expect(nextKey).not.toBe(fileKey(files[0]!));
    Object.defineProperty(nextCard, 'getBoundingClientRect', {
        value: () => domRect(0, 100, 200, 300)
    });

    await fireEvent.pointerMove(surface, {
        clientX: 300,
        clientY: 400,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(files[0]!), nextKey]));

    await fireEvent.pointerUp(surface, {
        clientX: 300,
        clientY: 400,
        pointerId: 1,
        pointerType: 'mouse'
    });
});

test('a marquee drops a mounted card when the rectangle shrinks away', async () => {
    const { onmarquee, surface } = mountGrid();

    await fireEvent.pointerDown(surface, {
        clientX: 0,
        clientY: 80,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse'
    });
    await fireEvent.pointerMove(surface, {
        clientX: 210,
        clientY: 320,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set([fileKey(first)]));

    await fireEvent.pointerMove(surface, {
        clientX: 210,
        clientY: 90,
        pointerId: 1,
        pointerType: 'mouse'
    });

    expect(onmarquee).toHaveBeenLastCalledWith(new Set());
    expect(document.querySelector(`[data-file-key="${fileKey(first)}"]`)).not.toBeNull();
});
