// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { folderFromUrl } from '#browser/drive/folder-history';
import { selectionScope } from '#browser/drive/selection-files';
import SelectionScope from '#components/SelectionScope.svelte';
import {
    currentFolder,
    makeLibrary,
    resetLibraryMocks,
    traverse,
    waitForPopState
} from './folder-history-fixtures';

vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return {
        ...actual,
        readLibraryPage: vi.fn(),
        readLibrarySnapshot: vi.fn(),
        readLibrarySync: vi.fn(),
        readGroupLibrary: vi.fn(),
        readGroupLibraryUpdates: vi.fn()
    };
});

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    resetLibraryMocks();
});

afterEach(() => cleanup());

test('opening folders pushes encoded entries and ignores the current folder', async () => {
    const library = makeLibrary(['Projects', 'Projects/Design', 'Projects/Design Notes']);
    await library.load();
    const initialLength = window.history.length;

    library.openFolder('Projects');
    expect(window.history.length).toBe(initialLength + 1);
    expect(currentFolder()).toBe('Projects');

    library.openFolder('Projects/Design');
    expect(window.history.length).toBe(initialLength + 2);
    expect(currentFolder()).toBe('Projects/Design');
    expect(window.location.search).toContain('folder=Projects%2FDesign');

    library.openFolder('Projects/Design Notes');
    expect(window.location.search).toContain('folder=Projects%2FDesign%20Notes');

    library.openFolder('Projects/Design Notes');
    expect(window.history.length).toBe(initialLength + 3);
});

test('back returns to the parent and forward reopens the child', async () => {
    const library = makeLibrary(['A', 'A/B']);
    await library.load();
    library.openFolder('A');
    library.openFolder('A/B');

    await traverse('back');
    expect(library.folder).toBe('A');
    expect(currentFolder()).toBe('A');
    expect(library.chunks).toHaveLength(2);

    await traverse('forward');
    expect(library.folder).toBe('A/B');
    expect(currentFolder()).toBe('A/B');

    await traverse('back');
    await traverse('back');
    expect(library.folder).toBe('');
    expect(currentFolder()).toBe('');
});

test('a breadcrumb replaces the current entry and Back does not reopen the child', async () => {
    const library = makeLibrary(['A', 'A/B']);
    await library.load();
    library.openFolder('A');
    library.openFolder('A/B');
    const length = window.history.length;

    library.openFolder('A', 'ancestor');

    expect(library.folder).toBe('A');
    expect(window.history.length).toBe(length);
    expect(currentFolder()).toBe('A');

    await traverse('back');
    expect(library.folder).toBe('A');
    expect(currentFolder()).toBe('A');

    await traverse('back');
    expect(library.folder).toBe('');
    expect(currentFolder()).toBe('');
});

test('a breadcrumb replaces the entry when the ancestor is not behind it', async () => {
    window.history.replaceState(null, '', '/?folder=A%2FB');
    const library = makeLibrary(['A', 'A/B']);
    await library.load();
    const length = window.history.length;

    library.openFolder('A', 'ancestor');

    expect(library.folder).toBe('A');
    expect(window.history.length).toBe(length);
    expect(currentFolder()).toBe('A');
});

test('a breadcrumb to the current folder adds no entry', async () => {
    const library = makeLibrary(['A', 'A/B']);
    await library.load();
    library.openFolder('A');
    const length = window.history.length;

    library.openFolder('A', 'ancestor');

    expect(library.folder).toBe('A');
    expect(window.history.length).toBe(length);
    expect(currentFolder()).toBe('A');
});

test('a forward entry after a replace cannot redirect a breadcrumb', async () => {
    const library = makeLibrary(['A', 'A/B', 'C']);
    await library.load();
    library.openFolder('A');
    library.openFolder('A/B');
    await traverse('back');
    library.openFolder('C', 'replace');
    const length = window.history.length;

    await traverse('forward');
    expect(library.folder).toBe('A/B');
    expect(currentFolder()).toBe('A/B');

    library.openFolder('A', 'ancestor');

    expect(library.folder).toBe('A');
    expect(window.history.length).toBe(length);
    expect(currentFolder()).toBe('A');

    await traverse('back');
    expect(library.folder).toBe('C');
    expect(currentFolder()).toBe('C');
});

test('a breadcrumb replace keeps later forward entries', async () => {
    const library = makeLibrary(['A', 'A/B', 'C']);
    await library.load();
    library.openFolder('A');
    library.openFolder('A/B');
    await traverse('back');

    library.openFolder('C', 'ancestor');
    expect(library.folder).toBe('C');

    await traverse('forward');
    expect(library.folder).toBe('A/B');
    expect(currentFolder()).toBe('A/B');
});

test('a breadcrumb replace from a deep link keeps the path encoded', async () => {
    window.history.replaceState(null, '', '/?folder=Projects%2FDesign%20Notes');
    const library = makeLibrary(['Projects/Design Notes']);
    await library.load();
    const length = window.history.length;

    library.openFolder('Projects', 'ancestor');

    expect(library.folder).toBe('Projects');
    expect(window.history.length).toBe(length);
    expect(new URL(window.location.href).searchParams.get('folder')).toBe('Projects');
});

test('a deep link restores the folder and a missing folder falls back to root', async () => {
    window.history.replaceState(null, '', '/?folder=Projects%2FDesign%20Notes');
    const linked = makeLibrary(['Projects/Design Notes']);
    linked.reset();
    await linked.load();

    expect(linked.folder).toBe('Projects/Design Notes');
    expect(folderFromUrl(window.location.href)).toBe('Projects/Design Notes');

    window.history.replaceState(null, '', '/?folder=Missing');
    const missing = makeLibrary(['Projects/Design Notes']);
    missing.reset();
    await missing.load();

    expect(missing.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('reset returns to root and removes the folder parameter', async () => {
    const library = makeLibrary(['A']);
    await library.load();
    library.openFolder('A');

    library.reset();
    await library.load();

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('a history folder change clears the selection scope', async () => {
    const library = makeLibrary(['A']);
    await library.load();
    library.openFolder('A');
    const onreset = vi.fn();
    const view = render(SelectionScope, {
        props: { scope: selectionScope(library), onreset }
    });

    const moved = waitForPopState();
    window.history.back();
    await moved;
    await view.rerender({ scope: selectionScope(library), onreset });

    expect(library.folder).toBe('');
    expect(onreset).toHaveBeenCalledTimes(1);
});

test('a breadcrumb replace keeps the file grid populated', async () => {
    const library = makeLibrary(['A', 'A/B']);
    await library.load();
    library.openFolder('A');
    library.openFolder('A/B');

    library.openFolder('A', 'ancestor');

    expect(library.folder).toBe('A');
    expect(library.chunks).toHaveLength(2);
    expect(library.loading).toBe(false);
});

test('folder history keeps unrelated query parameters', async () => {
    window.history.replaceState(null, '', '/?view=grid');
    const library = makeLibrary(['A']);
    await library.load();
    library.openFolder('A');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('view')).toBe('grid');
    expect(url.searchParams.get('folder')).toBe('A');
});
