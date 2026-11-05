import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type {
    GoogleAccountGroup,
    GoogleAccountSummary,
    LibraryResponse,
    RemoteBmp
} from '@madkarmaa/phodrive-core/models';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import type { DriveContext } from '#browser/drive/context.svelte';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { fileKey } from '@madkarmaa/phodrive-core/files';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/library', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/library')>();

    return { ...actual, readLibraryPage: vi.fn(), readLibrarySnapshot: vi.fn() };
});

const libraryApi = await import('@madkarmaa/phodrive-core/browser/library');

const A: GoogleAccountSummary = { id: 'account-a', email: 'a@example.com' };
const B: GoogleAccountSummary = { id: 'account-b', email: 'b@example.com' };
const C: GoogleAccountSummary = { id: 'account-c', email: 'c@example.com' };

function item(accountId: string, mediaKey: string, fileId = mediaKey): RemoteBmp {
    return {
        fileHash: 'a'.repeat(64),
        fileId: fileId.padEnd(64, '0'),
        chunkIndex: 0,
        isLast: true,
        originalName: `${mediaKey}.bin`,
        size: 4,
        at: 1,
        mediaKey,
        sha1: 'c'.repeat(40),
        accountId
    };
}

function page(items: RemoteBmp[], nextPageToken = ''): LibraryResponse {
    return { items, nextPageToken };
}

function asyncOk<T>(value: T) {
    return Ok(value).andThenAsync(async () => Ok(value));
}

function asyncErr(message: string) {
    return Ok(undefined).andThenAsync(async () =>
        Err({ code: 'REQUEST_FAILED', message } as const)
    );
}

function driveFor(group: GoogleAccountGroup, feedback: string[] = []) {
    return new DriveLibrary(
        () => ({ kind: 'group', group }),
        () => false,
        () => FileSort.ModifiedDescending,
        (message) => {
            if (message) feedback.push(message);
        }
    );
}

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('a metadata warning is surfaced without dropping the Google files', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A] };
    vi.mocked(libraryApi.readLibraryPage).mockImplementation(() =>
        asyncOk({
            items: [item(A.id, 'a1')],
            nextPageToken: '',
            warnings: [{ code: 'METADATA_SAVE_FAILED' }]
        })
    );
    const feedback: string[] = [];
    const library = driveFor(group, feedback);

    await library.load();

    expect(library.chunks).toHaveLength(1);
    expect(feedback).toContain('Files loaded, but Phodrive could not update its metadata index.');
});

test('initial pages merge and load more advances only accounts with a token', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A, B, C] };
    const pages = new Map<string, LibraryResponse>([
        ['account-a|', page([item(A.id, 'a1')], 'a2')],
        ['account-a|a2', page([item(A.id, 'a2')])],
        ['account-b|', page([item(B.id, 'b1')])],
        ['account-c|', page([item(C.id, 'c1')], 'c2')],
        ['account-c|c2', page([item(C.id, 'c2')], 'c3')],
        ['account-c|c3', page([item(C.id, 'c3')])]
    ]);
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((token = '', accountId = '') => {
        const response = pages.get(`${accountId}|${token}`);
        if (!response) return asyncErr(`unexpected page ${accountId}|${token}`);

        return asyncOk(response);
    });
    const library = driveFor(group);

    await library.load();

    expect(
        vi.mocked(libraryApi.readLibraryPage).mock.calls.map(([token, id]) => `${id}|${token}`)
    ).toEqual(['account-a|', 'account-b|', 'account-c|']);
    expect(library.chunks).toHaveLength(3);
    expect(library.chunks.find((chunk) => chunk.accountId === A.id)?.email).toBe(A.email);
    expect(library.chunks.find((chunk) => chunk.accountId === C.id)?.email).toBe(C.email);
    expect(library.hasMore).toBe(true);

    await library.load(false);
    expect(
        vi.mocked(libraryApi.readLibraryPage).mock.calls.map(([token, id]) => `${id}|${token}`)
    ).toEqual(['account-a|', 'account-b|', 'account-c|', 'account-a|a2', 'account-c|c2']);
    expect(library.chunks).toHaveLength(5);
    expect(library.hasMore).toBe(true);

    await library.load(false);
    expect(
        vi.mocked(libraryApi.readLibraryPage).mock.calls.map(([token, id]) => `${id}|${token}`)
    ).toEqual([
        'account-a|',
        'account-b|',
        'account-c|',
        'account-a|a2',
        'account-c|c2',
        'account-c|c3'
    ]);
    expect(library.chunks).toHaveLength(6);
    expect(library.hasMore).toBe(false);
});

test('repeated page tokens are tracked per account and do not discard other members', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A, B] };
    const pages = new Map<string, LibraryResponse>([
        ['account-a|', page([item(A.id, 'a1')], 'p2')],
        ['account-a|p2', page([item(A.id, 'a2')], 'p2')],
        ['account-b|', page([item(B.id, 'b1')], 'p2')],
        ['account-b|p2', page([item(B.id, 'b2')])]
    ]);
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((token = '', accountId = '') => {
        const response = pages.get(`${accountId}|${token}`);
        if (!response) return asyncErr(`unexpected page ${accountId}|${token}`);

        return asyncOk(response);
    });
    const feedback: string[] = [];
    const library = driveFor(group, feedback);

    await library.load();
    await library.load(false);

    expect(library.chunks.map((chunk) => chunk.mediaKey).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(feedback[0]).toContain('a@example.com');
    expect(feedback[0]).toContain('repeated a library page');
    expect(library.hasMore).toBe(false);
});

test('a failed member reports its own error while keeping successful members', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A, B, C] };
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((_token = '', accountId = '') => {
        if (accountId === B.id) return asyncErr('member unavailable');

        return asyncOk(page([item(accountId, `${accountId}-file`)]));
    });
    const feedback: string[] = [];
    const library = driveFor(group, feedback);

    await library.load();

    expect(library.chunks.map((chunk) => chunk.accountId).sort()).toEqual([A.id, C.id]);
    expect(library.loadFailed).toBe(false);
    expect(feedback[0]).toBe('Could not load b@example.com: member unavailable');
});

test('an empty group loads nothing and does not fall back to an account', async () => {
    const library = driveFor({ id: 'group-empty', name: 'Empty', members: [] });

    await library.load();

    expect(libraryApi.readLibraryPage).not.toHaveBeenCalled();
    expect(library.chunks).toEqual([]);
    expect(library.hasMore).toBe(false);
    expect(library.loadFailed).toBe(false);
});

test('refresh respects each member loaded depth', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A, B, C] };
    const pages = new Map<string, LibraryResponse>([
        ['account-a|', page([item(A.id, 'a1')], 'a2')],
        ['account-a|a2', page([item(A.id, 'a2')])],
        ['account-b|', page([item(B.id, 'b1')])],
        ['account-c|', page([item(C.id, 'c1')], 'c2')],
        ['account-c|c2', page([item(C.id, 'c2')], 'c3')]
    ]);
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((token = '', accountId = '') => {
        const response = pages.get(`${accountId}|${token}`);
        if (!response) return asyncErr(`unexpected page ${accountId}|${token}`);

        return asyncOk(response);
    });
    vi.mocked(libraryApi.readLibrarySnapshot).mockImplementation((depth, accountId = '') =>
        asyncOk({
            items: [item(accountId, `${accountId}-fresh`)],
            nextPageToken: `${accountId}-next`,
            pages: depth
        })
    );
    const library = driveFor(group);

    await library.load();
    await library.load(false);
    library.chunks = [];
    await library.refresh();

    expect(vi.mocked(libraryApi.readLibrarySnapshot).mock.calls).toEqual([
        [2, A.id],
        [1, B.id],
        [2, C.id]
    ]);
    expect(library.chunks.map((chunk) => chunk.mediaKey).sort()).toEqual([
        'account-a-fresh',
        'account-b-fresh',
        'account-c-fresh'
    ]);
});

test('identical file identifiers from two accounts remain distinct owners', async () => {
    const group: GoogleAccountGroup = { id: 'group', name: 'Group', members: [A, B] };
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((_token = '', accountId = '') =>
        asyncOk(page([item(accountId, 'shared-media', 'same-file')]))
    );
    const library = driveFor(group);

    await library.load();

    expect(library.chunks).toHaveLength(2);
    expect(library.files).toHaveLength(2);
    expect(new Set(library.files.map(fileKey)).size).toBe(2);
});

test('a context switch invalidates an in-flight group page', async () => {
    let resolveFirst: ((value: LibraryResponse) => void) | undefined;
    const first = Ok(undefined).andThenAsync(async () => {
        const value = await new Promise<LibraryResponse>((resolve) => {
            resolveFirst = resolve;
        });

        return Ok(value);
    });
    let context: DriveContext = {
        kind: 'group',
        group: { id: 'group', name: 'Group', members: [A] }
    };
    vi.mocked(libraryApi.readLibraryPage).mockImplementation((_token = '', accountId = '') => {
        if (accountId === A.id) return first;

        return asyncOk(page([item(accountId, 'c1')]));
    });
    const library = new DriveLibrary(
        () => context,
        () => false,
        () => FileSort.ModifiedDescending,
        () => {}
    );

    const stale = library.load();
    context = { kind: 'account', account: C };
    await library.load();
    resolveFirst?.(page([item(A.id, 'a1')]));
    await stale;

    expect(library.chunks.map((chunk) => chunk.accountId)).toEqual([C.id]);
    expect(library.loading).toBe(false);
});
