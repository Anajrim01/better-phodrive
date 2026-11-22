import { afterEach, expect, test, vi } from 'vitest';
import { FileSort, GOOGLE_ACCOUNT_HEADER } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { DriveContext } from '#browser/drive/context.svelte';
import { DriveFileLocations } from '#browser/drive/file-locations.svelte';
import { DriveLibrary } from '#browser/drive/library.svelte';

afterEach(() => vi.unstubAllGlobals());

function chunk(accountId: string, key: string, folder?: string): UploadedChunk {
    return {
        accountId,
        email: `${accountId}@example.com`,
        fileId: key.repeat(64),
        mediaKey: `${accountId}-${key}`,
        fileHash: 'f'.repeat(64),
        sha1: 'f'.repeat(40),
        folder,
        originalName: `${key}.bin`,
        chunkIndex: 0,
        isLast: true,
        size: 4,
        at: 1
    };
}

function locationsFor(chunks: UploadedChunk[], context: DriveContext | null = null) {
    const library = new DriveLibrary(
        () => context,
        () => false,
        () => FileSort.NameAscending,
        vi.fn()
    );
    library.appendChunks(chunks);
    return {
        library,
        locations: new DriveFileLocations(
            library,
            () => false,
            () => context
        )
    };
}

test('inline rename keeps the original metadata and applies only after a successful save', async () => {
    const { library, locations } = locationsFor([chunk('first', 'a', 'Work')]);
    const file = library.files[0];
    const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: 'Try again' }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ updated: true }));
    vi.stubGlobal('fetch', fetch);

    locations.startRename(file);
    await locations.rename(file, 'renamed.bin');
    expect(library.files[0].name).toBe('a.bin');
    expect(locations.renaming).not.toBeNull();
    expect(locations.error).toBe('Try again');

    await locations.rename(file, 'renamed.bin');
    expect(locations.renaming).toBeNull();
    expect(library.files[0]).toMatchObject({
        name: 'renamed.bin',
        folder: 'Work',
        fileId: file.fileId,
        chunks: [{ originalName: 'a.bin', folder: 'Work' }]
    });
});

test('the move picker uses the selected account and moves the selection in one request', async () => {
    const { library, locations } = locationsFor([
        chunk('first', 'a', 'Work'),
        chunk('first', 'b', 'Work'),
        chunk('first', 'c', 'Archive/2026'),
        chunk('second', 'a', 'Elsewhere')
    ]);
    const [first, second, , other] = library.files;
    const fetch = vi.fn(async (_path: string, _init: RequestInit) =>
        Response.json({ updated: true })
    );
    vi.stubGlobal('fetch', fetch);

    locations.select(first, true);
    locations.select(second, true);
    locations.select(other, true);
    expect(locations.selected).toEqual([first, second]);
    locations.startMove();
    expect(locations.folders.map((folder) => folder.name)).toEqual(['Archive', 'Work']);
    locations.destination = 'Archive';
    expect(locations.folders.map((folder) => folder.name)).toEqual(['2026']);
    locations.destination = 'Archive/2026';

    await locations.move();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe('/api/files/location');
    expect(new Headers(init.headers).get(GOOGLE_ACCOUNT_HEADER)).toBe('first');
    expect(JSON.parse(String(init.body))).toEqual({
        files: [first, second].map((file) => ({
            fileId: file.fileId,
            mediaKey: file.chunks[0].mediaKey,
            folder: 'Archive/2026'
        }))
    });
    expect(library.files.map((file) => file.folder)).toEqual([
        'Archive/2026',
        'Archive/2026',
        'Archive/2026',
        'Elsewhere'
    ]);
    expect(locations.selected).toEqual([]);
    expect(locations.moving).toBe(false);
});

test('a replacement cannot inherit an open rename or a missing selection', async () => {
    const a = chunk('first', 'a', 'Work');
    const b = chunk('second', 'b', 'Elsewhere');
    const { library, locations } = locationsFor([a, b]);
    const [first, second] = library.files;
    locations.startRename(first);
    locations.select(first, true);
    library.removeChunk(first, a);

    locations.select(second, true);
    library.appendChunks([a]);
    expect(locations.selected).toEqual([second]);

    library.appendChunks([{ ...a, mediaKey: 'replacement' }]);
    const replaced = library.files[0];
    expect(locations.isRenaming(replaced)).toBe(false);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await locations.rename(replaced, 'incorrect.bin');
    expect(fetch).not.toHaveBeenCalled();
});

test('a group moves files from different owners to one group folder in one request', async () => {
    const first = chunk('first', 'a', 'Work');
    const second = { ...chunk('second', 'a', 'Elsewhere'), mediaKey: first.mediaKey };
    const third = chunk('third', 'b', 'Archive/2026');
    const members = [first, second, third].map(({ accountId, email }) => ({
        id: accountId!,
        email
    }));
    const context = { kind: 'group', group: { id: 'group', name: 'Studio', members } } as const;
    const { library, locations } = locationsFor([first, second, third], context);
    const fetch = vi
        .fn<(_path: string, _init: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(Response.json({ error: 'Try again' }, { status: 503 }))
        .mockResolvedValueOnce(Response.json({ updated: true }));
    vi.stubGlobal('fetch', fetch);

    locations.select(library.files[0], true);
    locations.select(library.files[1], true);
    locations.startMove();
    expect(locations.destinationLabel).toBe('Studio');
    expect(locations.folders.map((folder) => folder.name)).toContain('Archive');
    locations.destination = 'Archive/2026';

    await locations.move();
    expect(locations.moving).toBe(true);
    expect(locations.selected).toHaveLength(2);
    expect(library.files.slice(0, 2).map((file) => file.folder)).toEqual(['Work', 'Elsewhere']);

    await locations.move();
    expect(locations.moving).toBe(false);
    expect(locations.selected).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [path, init] = fetch.mock.calls[1];
    expect(path).toBe('/api/account/groups/group/files/location');
    expect(new Headers(init.headers).has(GOOGLE_ACCOUNT_HEADER)).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({
        folder: 'Archive/2026',
        files: [first, second].map(({ accountId, fileId, mediaKey }) => ({
            accountId,
            fileId,
            mediaKey
        }))
    });
    expect(library.files.map(({ accountId, folder }) => [accountId, folder])).toEqual([
        ['first', 'Archive/2026'],
        ['second', 'Archive/2026'],
        ['third', 'Archive/2026']
    ]);
});
