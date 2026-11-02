// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
import { actionsUnavailable } from '#browser/drive/actions';
import FileGrid from '#components/FileGrid.svelte';
import { file } from './file-fixtures';

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

const folder: FolderEntry = { path: 'A', name: 'A', files: 1, subfolders: 0 };

beforeEach(() => cleanup());
afterEach(() => cleanup());

test('a refresh keeps loaded files visible, browsing enabled and actions disabled', async () => {
    const onopenfolder = vi.fn();
    const onopenpreview = vi.fn();
    const view = render(FileGrid, {
        props: {
            files: [file({ name: 'photo.png' })],
            folders: [folder],
            layout: FileLayout.Grid,
            sort: FileSort.NameAscending,
            loading: true,
            loadFailed: false,
            filtered: false,
            hasFiles: true,
            hasMore: false,
            actionsDisabled: true,
            browseDisabled: false,
            showFolder: false,
            onopenfolder,
            onopenpreview,
            onmovefiles: vi.fn(),
            dragging: false,
            onstartdrag: vi.fn(),
            onenddrag: vi.fn(),
            ondownload: vi.fn(),
            ondelete: vi.fn(),
            onrestore: vi.fn(),
            onfilemenu: vi.fn(),
            onfoldermenu: vi.fn(),
            onmore: vi.fn()
        }
    });

    expect(screen.getByRole('heading', { name: 'photo.png' })).toBeTruthy();
    expect(
        (screen.getByRole('checkbox', { name: 'Select photo.png' }) as HTMLInputElement).disabled
    ).toBe(false);
    expect(
        (screen.getByRole('button', { name: 'Open folder A' }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(
        (screen.getByRole('button', { name: 'Download photo.png' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'Delete photo.png' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'More actions for photo.png' }) as HTMLButtonElement)
            .disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'More actions for A' }) as HTMLButtonElement).disabled
    ).toBe(true);

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.doubleClick(shell);

    expect(onopenpreview).toHaveBeenCalledOnce();
});

test('an initial load blocks browsing and actions', async () => {
    const onopenpreview = vi.fn();
    const view = render(FileGrid, {
        props: {
            files: [file({ name: 'photo.png' })],
            folders: [folder],
            layout: FileLayout.Grid,
            sort: FileSort.NameAscending,
            loading: true,
            loadFailed: false,
            filtered: false,
            hasFiles: true,
            hasMore: false,
            actionsDisabled: true,
            browseDisabled: true,
            showFolder: false,
            onopenfolder: vi.fn(),
            onopenpreview,
            onmovefiles: vi.fn(),
            dragging: false,
            onstartdrag: vi.fn(),
            onenddrag: vi.fn(),
            ondownload: vi.fn(),
            ondelete: vi.fn(),
            onrestore: vi.fn(),
            onfilemenu: vi.fn(),
            onfoldermenu: vi.fn(),
            onmore: vi.fn()
        }
    });

    expect(
        (screen.getByRole('checkbox', { name: 'Select photo.png' }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'Open folder A' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'Download photo.png' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
        (screen.getByRole('button', { name: 'More actions for photo.png' }) as HTMLButtonElement)
            .disabled
    ).toBe(true);

    const shell = view.container.querySelector('.file-card-shell');
    if (!(shell instanceof HTMLElement)) throw new Error('Expected a card shell');
    await fireEvent.doubleClick(shell);

    expect(onopenpreview).not.toHaveBeenCalled();
});

test('library loading disables drive actions during refresh', () => {
    const drive = {
        busy: false,
        fileAction: null,
        library: { loading: true },
        bulk: { running: false, moveBusy: false }
    };

    expect(actionsUnavailable(drive, { busy: false })).toBe(true);
    expect(actionsUnavailable({ ...drive, library: { loading: false } }, { busy: false })).toBe(
        false
    );
});
