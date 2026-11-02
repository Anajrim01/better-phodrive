// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';
import {
    currentFolder,
    makeLibrary,
    page,
    remoteBmp,
    resetLibraryMocks,
    traverse
} from './folder-history-fixtures';

vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return {
        ...actual,
        readLibraryPage: vi.fn(),
        readLibrarySnapshot: vi.fn(),
        readLibrarySync: vi.fn()
    };
});

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    resetLibraryMocks();
});

test('a deep link stays pending while later pages may contain the folder', async () => {
    window.history.replaceState(null, '', '/?folder=Later');
    const library = makeLibrary([]);
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibraryPage)
        .mockReturnValueOnce(page(['A'], 'next-page'))
        .mockReturnValueOnce(page(['Later'], '', 1));

    library.reset();
    await library.load();

    expect(library.folder).toBe('Later');
    expect(currentFolder()).toBe('Later');

    await library.load(false);

    expect(library.folder).toBe('Later');
    expect(currentFolder()).toBe('Later');
    expect(library.chunks).toHaveLength(2);
});

test('a refresh does not discard a pending deep link', async () => {
    window.history.replaceState(null, '', '/?folder=Later');
    const library = makeLibrary([]);
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibraryPage)
        .mockReturnValueOnce(page(['A'], 'next-page'))
        .mockReturnValueOnce(page(['Later'], '', 1));
    vi.mocked(libraryApi.readLibrarySnapshot).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remoteBmp('A', 0)],
                nextPageToken: 'next-page',
                pages: 1,
                revision: 2
            })
        )
    );

    library.reset();
    await library.load();

    expect(library.folder).toBe('Later');
    expect(currentFolder()).toBe('Later');

    await library.refresh(true);

    expect(library.folder).toBe('Later');
    expect(currentFolder()).toBe('Later');

    await library.load(false);

    expect(library.folder).toBe('Later');
});

test('a refresh with no more pages settles a missing deep link to root', async () => {
    window.history.replaceState(null, '', '/?folder=Missing');
    const library = makeLibrary([]);
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibraryPage).mockReturnValueOnce(page(['A'], 'next-page'));
    vi.mocked(libraryApi.readLibrarySnapshot).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remoteBmp('A', 0)],
                nextPageToken: '',
                pages: 1,
                revision: 2
            })
        )
    );

    library.reset();
    await library.load();

    expect(library.folder).toBe('Missing');
    expect(currentFolder()).toBe('Missing');

    await library.refresh(true);

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('a history move during the initial restore cancels the pending deep link', async () => {
    window.history.replaceState(null, '', '/');
    window.history.pushState(null, '', '/?folder=Later');
    const library = makeLibrary([]);
    vi.mocked(libraryApi.readLibraryPage).mockReset();
    vi.mocked(libraryApi.readLibraryPage)
        .mockReturnValueOnce(page(['A'], 'next-page'))
        .mockReturnValueOnce(page(['Later'], '', 1));

    library.reset();
    await library.load();

    expect(library.folder).toBe('Later');
    expect(currentFolder()).toBe('Later');

    await traverse('back');

    expect(library.folder).toBe('');
    expect(currentFolder()).toBe('');

    await library.load(false);

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('a later reset before the first load clears the pending deep link', async () => {
    window.history.replaceState(null, '', '/?folder=Old');
    const library = makeLibrary(['Old']);
    library.reset();
    library.reset();
    await library.load();

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('a refresh that removes the open folder resets the URL', async () => {
    const library = makeLibrary(['A']);
    await library.load();
    library.openFolder('A');
    vi.mocked(libraryApi.readLibrarySnapshot).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [], nextPageToken: '', pages: 1, revision: 2 })
        )
    );

    await library.refresh(true);

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});

test('a sync that removes the open folder resets the URL', async () => {
    const library = makeLibrary(['A']);
    await library.load();
    library.openFolder('A');
    vi.mocked(libraryApi.readLibrarySync).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [], deleted: [], full: true, revision: 2 })
        )
    );

    await library.refresh();

    expect(library.folder).toBe('');
    expect(new URL(window.location.href).searchParams.has('folder')).toBe(false);
});
