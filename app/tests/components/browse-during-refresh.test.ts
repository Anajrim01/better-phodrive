// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
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

test('a refresh keeps loaded files visible and browsing enabled', () => {
    const onopenfolder = vi.fn();
    render(FileGrid, {
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
            actionsDisabled: false,
            browseDisabled: false,
            showFolder: false,
            onopenfolder,
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
});

test('an initial load keeps the grid blocked until files arrive', () => {
    render(FileGrid, {
        props: {
            files: [],
            folders: [folder],
            layout: FileLayout.Grid,
            sort: FileSort.NameAscending,
            loading: true,
            loadFailed: false,
            filtered: false,
            hasFiles: false,
            hasMore: false,
            actionsDisabled: false,
            browseDisabled: true,
            showFolder: false,
            onopenfolder: vi.fn(),
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

    expect(screen.queryByRole('heading', { name: 'photo.png' })).toBeNull();
    expect(
        (screen.getByRole('button', { name: 'Open folder A' }) as HTMLButtonElement).disabled
    ).toBe(true);
});
