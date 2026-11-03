import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import {
    readLibraryPage,
    readLibrarySnapshot,
    readLibrarySync
} from '@madkarmaa/phodrive-core/browser/library';
import type { LibrarySyncResponse } from '@madkarmaa/phodrive-core/library-sync';
import { DriveLibrary } from '#browser/drive/library.svelte';

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

const EMAIL = 'owner@example.com';
const TOKEN = 'aas_et/test';
const SYNC_ERROR: ApplicationError = {
    code: 'REQUEST_FAILED',
    message: 'Could not sync files.'
};

vi.stubGlobal('document', { hidden: false });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

function remote(mediaKey: string): RemoteBmp {
    return {
        mediaKey,
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        sha1: 'b'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: `${mediaKey}.bin`,
        size: 4,
        at: 1
    };
}

function chunk(mediaKey: string): UploadedChunk {
    return { ...remote(mediaKey), email: EMAIL };
}

function failure<T>(error: ApplicationError) {
    return Ok(undefined).andThenAsync<T, ApplicationError>(async () => Err(error));
}

function makeLibrary() {
    const feedback = vi.fn();

    return {
        feedback,
        library: new DriveLibrary(
            () => ({ email: EMAIL, token: TOKEN }),
            () => false,
            () => FileSort.NameAscending,
            feedback
        )
    };
}

test('the first load uses the sync snapshot without scanning pages', async () => {
    const { feedback, library } = makeLibrary();
    vi.mocked(readLibrarySync).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remote('synced')],
                deleted: [],
                full: true,
                revision: 7
            })
        )
    );

    await library.load();

    expect(readLibrarySync).toHaveBeenCalledWith(EMAIL, TOKEN, false, 0);
    expect(readLibraryPage).not.toHaveBeenCalled();
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['synced']);
    expect(library.revisions.get(EMAIL)).toBe(7);
    expect(library.loadedPages).toBe(1);
    expect(library.nextPageToken).toBe('');
    expect(library.loading).toBe(false);
    expect(feedback).not.toHaveBeenCalledWith(expect.stringContaining('Could not'));
});

test('a failed sync falls back to the page scan and still fills the library', async () => {
    const { feedback, library } = makeLibrary();
    const syncError: ApplicationError = {
        code: 'REQUEST_FAILED',
        message: 'Could not sync files.'
    };
    vi.mocked(readLibrarySync).mockReturnValueOnce(failure<LibrarySyncResponse>(syncError));
    vi.mocked(readLibraryPage).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [remote('scanned')], nextPageToken: '', revision: 4 })
        )
    );

    await library.load();

    expect(readLibrarySync).toHaveBeenCalledWith(EMAIL, TOKEN, false, 0);
    expect(readLibraryPage).toHaveBeenCalledWith(EMAIL, TOKEN, '');
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['scanned']);
    expect(library.loadFailed).toBe(false);
    expect(library.loading).toBe(false);
    expect(feedback).not.toHaveBeenCalledWith(syncError.message);
});

test('a later page load still scans with the next page token', async () => {
    const { library } = makeLibrary();
    library.chunks = [chunk('first')];
    library.nextPageToken = 'page-two';
    library.loadedPages = 1;
    vi.mocked(readLibraryPage).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [remote('second')], nextPageToken: '', revision: 4 })
        )
    );

    await library.load(false);

    expect(readLibrarySync).not.toHaveBeenCalled();
    expect(readLibraryPage).toHaveBeenCalledWith(EMAIL, TOKEN, 'page-two');
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['first', 'second']);
    expect(library.loadedPages).toBe(2);
    expect(library.nextPageToken).toBe('');
});

test('a partial sync answer is treated as a miss', async () => {
    const { library } = makeLibrary();
    vi.mocked(readLibrarySync).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [remote('delta')], deleted: [], full: false, revision: 3 })
        )
    );
    vi.mocked(readLibraryPage).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [remote('scanned')], nextPageToken: '', revision: 4 })
        )
    );

    await library.load();

    expect(readLibraryPage).toHaveBeenCalledWith(EMAIL, TOKEN, '');
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['scanned']);
});

test('a refresh fallback after a full sync load keeps every synced item', async () => {
    const { library } = makeLibrary();
    vi.mocked(readLibrarySync).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remote('first'), remote('second')],
                deleted: [],
                full: true,
                revision: 7
            })
        )
    );

    await library.load();

    expect(library.nextPageToken).toBe('');

    vi.mocked(readLibrarySync).mockReturnValueOnce(failure<LibrarySyncResponse>(SYNC_ERROR));
    vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remote('first'), remote('second')],
                nextPageToken: '',
                pages: 1,
                revision: 8
            })
        )
    );

    await library.refresh(true);

    expect(readLibrarySnapshot).toHaveBeenCalledWith(EMAIL, TOKEN, Number.POSITIVE_INFINITY);
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['first', 'second']);
    expect(library.loadedPages).toBe(1);
    expect(library.loadFailed).toBe(false);
});

test('a refresh fallback with a page cursor keeps the loaded depth', async () => {
    const { library } = makeLibrary();
    library.chunks = [chunk('first')];
    library.nextPageToken = 'page-two';
    library.loadedPages = 3;
    library.revisions.set(EMAIL, 4);
    vi.mocked(readLibrarySync).mockReturnValueOnce(failure<LibrarySyncResponse>(SYNC_ERROR));
    vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({
                items: [remote('first'), remote('second')],
                nextPageToken: 'page-four',
                pages: 3,
                revision: 5
            })
        )
    );

    await library.refresh(true);

    expect(readLibrarySnapshot).toHaveBeenCalledWith(EMAIL, TOKEN, 3);
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['first', 'second']);
    expect(library.loadedPages).toBe(3);
    expect(library.nextPageToken).toBe('page-four');
});
