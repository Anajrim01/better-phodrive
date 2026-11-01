// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { FileGroup, FolderEntry, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { MenuAction } from '#lib/menus';
import type { MenuTarget } from '#browser/drive/menu-types';
import EntryMenu from '#components/EntryMenu.svelte';

vi.hoisted(() => {
    const originalMatches = Element.prototype.matches;

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

    Object.defineProperty(Element.prototype, 'matches', {
        configurable: true,
        value: function (this: Element, selector: string) {
            if (selector === ':popover-open') return this.hasAttribute('data-popover-open');

            return originalMatches.call(this, selector);
        }
    });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
        configurable: true,
        value: function (this: HTMLElement) {
            this.removeAttribute('popover');
            this.setAttribute('data-popover-open', '');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'open' });
            this.dispatchEvent(event);
        }
    });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
        configurable: true,
        value: function (this: HTMLElement) {
            this.removeAttribute('data-popover-open');
            const event = new Event('toggle');
            Object.defineProperty(event, 'newState', { value: 'closed' });
            this.dispatchEvent(event);
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

function mount(
    target: MenuTarget,
    callbacks: { onclose?: () => void; onaction?: (action: MenuAction) => void } = {}
) {
    const onclose = callbacks.onclose ?? vi.fn();
    const onaction = callbacks.onaction ?? vi.fn();

    render(EntryMenu, {
        props: {
            open: true,
            target,
            anchor: { x: 40, y: 80 },
            onclose,
            onaction
        }
    });

    return { onclose, onaction };
}

beforeEach(() => cleanup());
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

test('a file menu opens with each action once', async () => {
    mount({ kind: 'file', item: file() });

    await waitFor(() => expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(5));
    expect(
        screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
    ).toEqual(['Download', 'Rename', 'Move to folder', 'Delete', 'Details']);
});

test('choosing an action closes the menu and reports the action', async () => {
    const onaction = vi.fn();
    mount({ kind: 'file', item: file() }, { onaction });

    const rename = await screen.findByRole('menuitem', { name: 'Rename', hidden: true });
    await fireEvent.click(rename);

    expect(onaction).toHaveBeenCalledWith('rename');
});

test('the trash and folder menus show their own actions', async () => {
    mount({ kind: 'file', item: file({ trashed: true }) });
    await waitFor(() => expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(3));
    expect(
        screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
    ).toEqual(['Restore', 'Delete forever', 'Details']);

    cleanup();
    const folder: FolderEntry = { path: 'A', name: 'A', files: 2, subfolders: 1 };
    mount({ kind: 'folder', entry: folder });
    await waitFor(() => expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(6));
    expect(
        screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
    ).toEqual([
        'Open',
        'Rename',
        'Move folder',
        'Move contents to My files',
        'Delete folder and files',
        'Details'
    ]);
});

test('the bulk menu has no rename and swaps to trash actions in Trash', async () => {
    mount({ kind: 'selection', files: [file()], trash: false });
    await waitFor(() => expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(4));
    expect(
        screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
    ).toEqual(['Download', 'Move to folder', 'Delete', 'Details']);

    cleanup();
    mount({ kind: 'selection', files: [file({ trashed: true })], trash: true });
    await waitFor(() => expect(screen.getAllByRole('menuitem', { hidden: true })).toHaveLength(3));
    expect(
        screen.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim())
    ).toEqual(['Restore', 'Delete forever', 'Details']);
});

test('arrow keys move focus between menu items', async () => {
    mount({ kind: 'file', item: file() });
    const items = await screen.findAllByRole('menuitem', { hidden: true });

    items[0]!.focus();
    expect(document.activeElement).toBe(items[0]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(document.activeElement?.textContent?.trim()).toBe('Rename');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(document.activeElement?.textContent?.trim()).toBe('Details');
});

test('Escape, outside pointer down, and scroll all close the menu', async () => {
    for (const close of [
        () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
        () => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
        () => window.dispatchEvent(new Event('scroll'))
    ]) {
        const onclose = vi.fn();
        mount({ kind: 'file', item: file() }, { onclose });
        await waitFor(() =>
            expect(screen.getAllByRole('menuitem', { hidden: true }).length).toBeGreaterThan(0)
        );

        close();

        expect(onclose).toHaveBeenCalled();
        cleanup();
    }
});

test('focus returns to the opening element', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'More';
    document.body.append(trigger);
    trigger.focus();
    const view = render(EntryMenu, {
        props: {
            open: true,
            target: { kind: 'file', item: file() },
            anchor: trigger,
            onclose: vi.fn(),
            onaction: vi.fn()
        }
    });
    await screen.findByRole('menuitem', { name: 'Rename', hidden: true });
    trigger.blur();
    document.body.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await view.rerender({
        open: false,
        target: { kind: 'file', item: file() },
        anchor: trigger,
        onclose: vi.fn(),
        onaction: vi.fn()
    });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
});
