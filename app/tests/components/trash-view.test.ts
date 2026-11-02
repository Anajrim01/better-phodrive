// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import TrashView from '#components/TrashView.svelte';

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
});

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

test('the trash view states the 30-day Google Photos deletion window', () => {
    render(TrashView, {
        props: {
            files: [],
            sort: FileSort.ModifiedDescending,
            disabled: false,
            loading: false,
            loadFailed: false,
            hasMore: false,
            action: null,
            onrestore: vi.fn(),
            ondeleteforever: vi.fn(),
            onmenu: vi.fn(),
            onmore: vi.fn()
        }
    });

    expect(
        screen.getByText(
            'Google Photos deletes trashed files after 30 days. Restore them or delete them forever.'
        )
    ).toBeTruthy();
});

test('an empty first page offers Load more instead of claiming Trash is empty', () => {
    render(TrashView, {
        props: {
            files: [],
            sort: FileSort.ModifiedDescending,
            disabled: false,
            loading: false,
            loadFailed: false,
            hasMore: true,
            action: null,
            onrestore: vi.fn(),
            ondeleteforever: vi.fn(),
            onmenu: vi.fn(),
            onmore: vi.fn()
        }
    });

    expect(screen.getByRole('status').textContent).toContain(
        'No trashed files in the loaded pages'
    );
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
});
