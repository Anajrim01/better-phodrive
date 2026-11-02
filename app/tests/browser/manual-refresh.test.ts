import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import {
    readGroupLibrary,
    readGroupLibraryUpdates,
    readLibraryPage,
    readLibrarySnapshot,
    readLibrarySync,
    type GroupLibrarySnapshot
} from '@madkarmaa/phodrive-core/browser/library';
import type { LibrarySyncResponse } from '@madkarmaa/phodrive-core/library-sync';
import { DriveLibrary } from '#browser/drive/library.svelte';

vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return {
        ...actual,
        readGroupLibrary: vi.fn(),
        readGroupLibraryUpdates: vi.fn(),
        readLibraryPage: vi.fn(),
        readLibrarySnapshot: vi.fn(),
        readLibrarySync: vi.fn()
    };
});

const EMAIL = 'owner@example.com';
const TOKEN = 'aas_et/test';

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

function deferred<T>() {
    let resolve: ((value: T) => void) | undefined;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });

    return { promise, resolve: (value: T) => resolve?.(value) };
}

function failure<T>(error: ApplicationError) {
    return Ok(undefined).andThenAsync<T, ApplicationError>(async () => Err(error));
}

function makeLibrary(
    group: () => {
        members: readonly { email: string; token: string }[];
        missing: string[];
    } | null = () => null
) {
    return new DriveLibrary(
        () => ({ email: EMAIL, token: TOKEN }),
        () => false,
        () => FileSort.NameAscending,
        () => {},
        group
    );
}

function groupSnapshot(accounts: GroupAccountState[]) {
    return {
        chunks: [chunk('group')],
        accounts,
        partial: false,
        revisions: { [EMAIL]: 3 }
    };
}

test('manual refresh applies a delta when a cursor exists and leaves the grid visible', async () => {
    const library = makeLibrary();
    library.chunks = [chunk('old'), chunk('kept')];
    library.revisions.set(EMAIL, 4);
    library.loadedPages = 2;
    library.nextPageToken = 'next-page';
    const pending = deferred<Awaited<ReturnType<typeof readLibrarySync>>>();
    vi.mocked(readLibrarySync).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => pending.promise)
    );

    const refresh = library.refresh(true);

    expect(readLibrarySync).toHaveBeenCalledWith(EMAIL, TOKEN, false, 4);
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['old', 'kept']);
    expect(library.initialLoading).toBe(false);

    pending.resolve(Ok({ items: [remote('new')], deleted: ['old'], full: false, revision: 5 }));
    await refresh;

    expect(readLibrarySnapshot).not.toHaveBeenCalled();
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['kept', 'new']);
    expect(library.revisions.get(EMAIL)).toBe(5);
    expect(library.loadedPages).toBe(2);
    expect(library.nextPageToken).toBe('next-page');
    expect(library.loading).toBe(false);
});

test('manual refresh uses a full snapshot when no cursor exists', async () => {
    const library = makeLibrary();
    library.chunks = [chunk('old')];
    vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Ok({ items: [remote('snapshot')], nextPageToken: '', pages: 1, revision: 8 })
        )
    );

    await library.refresh(true);

    expect(readLibrarySync).not.toHaveBeenCalled();
    expect(readLibrarySnapshot).toHaveBeenCalledWith(EMAIL, TOKEN, 0);
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['snapshot']);
});

const syncFailures: [string, ApplicationError][] = [
    [
        'a rejected sync token',
        { code: 'REQUEST_FAILED', message: 'Library sync state was rejected' }
    ],
    ['a failed delta', { code: 'REQUEST_FAILED', message: 'Could not sync files.' }]
];

test.each(syncFailures)(
    'manual refresh falls back to a full snapshot after %s',
    async (_label, error) => {
        const library = makeLibrary();
        library.chunks = [chunk('old')];
        library.revisions.set(EMAIL, 4);
        vi.mocked(readLibrarySync).mockReturnValueOnce(failure<LibrarySyncResponse>(error));
        vi.mocked(readLibrarySnapshot).mockReturnValueOnce(
            Ok(undefined).andThenAsync(async () =>
                Ok({ items: [remote('snapshot')], nextPageToken: '', pages: 1, revision: 8 })
            )
        );

        await library.refresh(true);

        expect(readLibrarySync).toHaveBeenCalledWith(EMAIL, TOKEN, false, 4);
        expect(readLibrarySnapshot).toHaveBeenCalledWith(EMAIL, TOKEN, 0);
        expect(library.chunks.map((item) => item.mediaKey)).toEqual(['snapshot']);
        expect(library.loading).toBe(false);
    }
);

test('a group manual refresh uses member updates', async () => {
    const members = [{ email: EMAIL, token: TOKEN }];
    const library = makeLibrary(() => ({ members, missing: [] }));
    const accounts: GroupAccountState[] = [{ email: EMAIL, status: 'ok' }];
    vi.mocked(readGroupLibraryUpdates).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () => Ok(groupSnapshot(accounts)))
    );

    await library.refresh(true);

    expect(readGroupLibraryUpdates).toHaveBeenCalledWith(members, [], [], [], expect.any(Map));
    expect(readGroupLibrary).not.toHaveBeenCalled();
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['group']);
    expect(library.accounts).toEqual(accounts);
});

test('a group manual refresh falls back to a full read when updates fail', async () => {
    const members = [{ email: EMAIL, token: TOKEN }];
    const library = makeLibrary(() => ({ members, missing: [] }));
    const accounts: GroupAccountState[] = [{ email: EMAIL, status: 'ok' }];
    vi.mocked(readGroupLibraryUpdates).mockReturnValueOnce(
        failure<GroupLibrarySnapshot>({ code: 'REQUEST_FAILED', message: 'Could not sync files.' })
    );
    vi.mocked(readGroupLibrary).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () => Ok(groupSnapshot(accounts)))
    );

    await library.refresh(true);

    expect(readGroupLibrary).toHaveBeenCalledWith(members, []);
    expect(library.chunks.map((item) => item.mediaKey)).toEqual(['group']);
    expect(library.loading).toBe(false);
});

test('a stale group load cannot overwrite a reset library', async () => {
    const members = [{ email: EMAIL, token: TOKEN }];
    const library = makeLibrary(() => ({ members, missing: [] }));
    const pending = deferred<Awaited<ReturnType<typeof readGroupLibrary>>>();
    vi.mocked(readGroupLibrary).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => pending.promise)
    );

    const load = library.load();
    library.reset();
    pending.resolve(Ok(groupSnapshot([{ email: EMAIL, status: 'ok' }])));
    await load;

    expect(library.chunks).toEqual([]);
    expect(library.accounts).toEqual([]);
});

test('initial loading stays blocked until the first page arrives', async () => {
    const library = makeLibrary();
    const pending = deferred<Awaited<ReturnType<typeof readLibraryPage>>>();
    vi.mocked(readLibraryPage).mockReturnValueOnce(
        Ok(undefined).andThenAsync(() => pending.promise)
    );

    const load = library.load();

    expect(library.initialLoading).toBe(true);

    pending.resolve(Ok({ items: [remote('first')], nextPageToken: '', revision: 1 }));
    await load;

    expect(library.initialLoading).toBe(false);
});
