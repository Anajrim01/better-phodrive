// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import FileGrid from '#components/FileGrid.svelte';
import { file, selectionCallbacks } from './file-fixtures';

let scrollPosition = 0;
let liveScroll = true;
Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollPosition,
    set: (value: number) => {
        scrollPosition = value;
    }
});
Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => 500_000
});
Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: (options: ScrollToOptions | number, y?: number) => {
        scrollPosition = typeof options === 'number' ? (y ?? 0) : (options.top ?? 0);
        if (liveScroll) window.dispatchEvent(new Event('scroll'));
    }
});

beforeEach(() => {
    scrollPosition = 0;
    liveScroll = true;
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

async function scrollTo(position: number): Promise<void> {
    scrollPosition = position;
    window.dispatchEvent(new Event('scroll'));
    await tick();
    await tick();
}

async function pressArrow(key: string, count: number): Promise<void> {
    for (let index = 0; index < count; index++) {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) throw new Error('Expected focused element');

        active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        window.dispatchEvent(new Event('scroll'));
        await tick();
        await tick();
    }
}

function pendingArrow(card: HTMLElement, count: number): void {
    for (let index = 0; index < count; index++) {
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
}

test('arrow focus crosses an unmounted grid boundary', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files) });
    const first = screen.getByRole('group', { name: 'file-0.bin' });

    first.focus();
    await pressArrow('ArrowDown', 30);

    expect((document.activeElement as HTMLElement)?.dataset.fileIndex).toBe('30');
    expect(scrollPosition).toBeGreaterThan(0);
});

test('arrow focus crosses an unmounted list boundary', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files, { layout: FileLayout.List }) });
    const first = screen.getByText('file-0.bin').closest('tr');
    if (!first) throw new Error('Expected a row');

    first.focus();
    await pressArrow('ArrowDown', 60);

    expect((document.activeElement as HTMLElement)?.dataset.fileIndex).toBe('60');
    expect(scrollPosition).toBeGreaterThan(0);
});

test('a pointer press cancels pending keyboard focus', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files) });
    const first = screen.getByRole('group', { name: 'file-0.bin' });
    const download = screen.getByRole('button', { name: 'Download file-1.bin' });

    liveScroll = false;
    first.focus();
    pendingArrow(first, 30);
    download.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    liveScroll = true;
    await scrollTo(30 * 246);

    expect((document.activeElement as HTMLElement)?.dataset.fileIndex).not.toBe('30');
});

test('focus moving to an outside control cancels pending keyboard focus', async () => {
    const files = manyFiles(500);
    render(FileGrid, { props: gridProps(files) });
    const first = screen.getByRole('group', { name: 'file-0.bin' });
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.append(outside);

    liveScroll = false;
    first.focus();
    pendingArrow(first, 30);
    outside.focus();

    liveScroll = true;
    await scrollTo(30 * 246);

    expect(document.activeElement).toBe(outside);
});

test('a changed filtered result cancels pending keyboard focus', async () => {
    const files = manyFiles(500);
    const replacement = Array.from({ length: 60 }, (_, index) =>
        file({
            fileId: (index + 1000).toString(16).padStart(64, '0'),
            name: `other-${index}.bin`
        })
    );
    const view = render(FileGrid, { props: gridProps(files) });
    const first = screen.getByRole('group', { name: 'file-0.bin' });

    liveScroll = false;
    first.focus();
    pendingArrow(first, 30);
    view.rerender(gridProps(replacement));

    liveScroll = true;
    await scrollTo(30 * 246);

    expect((document.activeElement as HTMLElement)?.dataset.fileIndex).not.toBe('30');
});
