import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { missingChunks } from '@madkarmaa/phodrive-core/files';
import { partitionFileGroups } from '@madkarmaa/phodrive-core/trash';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { listBmps, syncLibrary } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    SYNC_ONE,
    SYNC_TWO,
    chunkItem,
    emptyCounts,
    fetcherFor,
    fileChunk,
    pageBytes
} from '../helpers/delta-library';

const EMAIL = 'trash@example.com';
const TOKEN = 'aas_et/trash';

let folder = '';

function syncWith(fetcher: Parameters<typeof syncLibrary>[4], revision = 0, force = false) {
    return syncLibrary(EMAIL, TOKEN, force, revision, fetcher);
}

function groupsOf(items: Iterable<RemoteBmp>) {
    return partitionFileGroups(
        [...items].map((item) => ({ ...item, email: EMAIL })) as UploadedChunk[]
    );
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-trash-'));
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    await rm(folder, { recursive: true, force: true });
});

test('a full sync keeps hidden chunks with their metadata and flags them trashed', async () => {
    const hidden = chunkItem(0);
    const counts = emptyCounts();
    const fetcher = fetcherFor(
        [hidden],
        [
            pageBytes([], '', {
                syncToken: SYNC_ONE,
                trashed: [hidden]
            })
        ],
        counts,
        {
            delta: pageBytes([], '', { syncToken: SYNC_TWO })
        }
    );

    const cold = await syncWith(fetcher);
    const item = cold.unwrap().items[0];
    const groups = groupsOf(cold.unwrap().items);

    expect(item).toMatchObject({
        mediaKey: hidden.mediaKey,
        sha1: hidden.sha1,
        originalName: 'file-0.bin',
        chunkIndex: 0,
        chunkCount: 1,
        trashedAt: expect.any(Number)
    });
    expect(groups.files).toHaveLength(0);
    expect(groups.trashed).toHaveLength(1);
    expect(groups.trashed[0]).toMatchObject({
        name: 'file-0.bin',
        chunkCount: 1,
        complete: true,
        trashed: true
    });
    expect(groups.trashed[0].fileId).not.toBe(groups.trashed[0].fileHash);
});

test('a hidden delta item marks the indexed chunk trashed instead of deleting it', async () => {
    const items = [chunkItem(0)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: [items[0]] })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);
    const state = readAccountState(EMAIL);
    const groups = groupsOf(state?.items.values() ?? []);

    expect(warm.unwrap().deleted).toEqual([]);
    expect(warm.unwrap().items[0]).toMatchObject({
        mediaKey: 'chunk-0',
        trashedAt: expect.any(Number)
    });
    expect(state?.items.get('chunk-0')?.trashedAt).toEqual(expect.any(Number));
    expect(groups.files).toHaveLength(0);
    expect(groups.trashed).toHaveLength(1);
});

test('a partly trashed file stays in the main list with the missing chunk warning', async () => {
    const items = [fileChunk(0, 0, 2), fileChunk(0, 1, 2)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: [items[0]] })
    });

    const cold = await syncWith(fetcher);
    await syncWith(fetcher, cold.unwrap().revision);
    const groups = groupsOf(readAccountState(EMAIL)?.items.values() ?? []);

    expect(groups.trashed).toHaveLength(0);
    expect(groups.files).toHaveLength(1);
    expect(groups.files[0].complete).toBe(false);
    expect(groups.files[0].chunkCount).toBe(2);
    expect(missingChunks(groups.files[0].chunks, 2)).toBe(1);
    expect(groups.files[0].trashedChunks.map((chunk) => chunk.mediaKey)).toEqual(['chunk-0-0']);
    expect(groups.files[0].name).toBe('file-0.bin');
});

test('a visible sibling supplies the folder and file identity for a hidden chunk', async () => {
    const items = [fileChunk(1, 0, 2, 'Projects'), fileChunk(1, 1, 2, 'Projects')];
    const counts = emptyCounts();
    const fetcher = fetcherFor(
        items,
        [pageBytes([items[0]], '', { syncToken: SYNC_ONE, trashed: [items[1]] })],
        counts,
        {
            delta: pageBytes([], '', { syncToken: SYNC_TWO })
        }
    );

    const cold = await syncWith(fetcher);
    const groups = groupsOf(cold.unwrap().items);

    expect(groups.trashed).toHaveLength(0);
    expect(groups.files).toHaveLength(1);
    expect(groups.files[0].folder).toBe('Projects');
    expect(groups.files[0].complete).toBe(false);
    expect(groups.files[0].trashedChunks).toHaveLength(1);
    expect(groups.files[0].fileId).not.toBe(groups.files[0].fileHash);
});

test('a visible sibling on another page supplies the folder hint', async () => {
    const visible = fileChunk(2, 0, 2, 'Projects');
    const hidden = fileChunk(2, 1, 2, 'Projects');
    const counts = emptyCounts();
    const fetcher = fetcherFor(
        [visible, hidden],
        [
            pageBytes([], 'page-1', { syncToken: SYNC_ONE, trashed: [hidden] }),
            pageBytes([visible], '', {})
        ],
        counts,
        {
            delta: pageBytes([], '', { syncToken: SYNC_TWO })
        }
    );

    const cold = await syncWith(fetcher);
    const groups = groupsOf(cold.unwrap().items);

    expect(groups.trashed).toHaveLength(0);
    expect(groups.files).toHaveLength(1);
    expect(groups.files[0].folder).toBe('Projects');
    expect(groups.files[0].trashedChunks).toHaveLength(1);
});

test('a fully trashed file moves to the trash group only', async () => {
    const items = [fileChunk(0, 0, 2), fileChunk(0, 1, 2)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: items })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);
    const groups = groupsOf(readAccountState(EMAIL)?.items.values() ?? []);

    expect(warm.unwrap().deleted).toEqual([]);
    expect(groups.files).toHaveLength(0);
    expect(groups.trashed).toHaveLength(1);
    expect(groups.trashed[0]).toMatchObject({
        name: 'file-0.bin',
        chunkCount: 2,
        complete: true,
        trashed: true
    });
});

test('a permanent deletion removes the chunk from the index', async () => {
    const items = [chunkItem(0)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, deleted: ['chunk-0'] })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);

    expect(warm.unwrap().deleted).toEqual(['chunk-0']);
    expect(readAccountState(EMAIL)?.items.has('chunk-0')).toBe(false);
});

test('an ordinary hidden photo without the chunk marker is ignored', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: ['photo-1'] })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);

    expect(warm.unwrap()).toEqual({
        items: [],
        deleted: [],
        full: false,
        revision: cold.unwrap().revision
    });
    expect(readAccountState(EMAIL)?.items.size).toBe(40);
});

test('a key-only hidden delta entry still marks an indexed chunk trashed', async () => {
    const items = [chunkItem(0)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: ['chunk-0'] })
    });

    const cold = await syncWith(fetcher);
    await syncWith(fetcher, cold.unwrap().revision);

    expect(readAccountState(EMAIL)?.items.get('chunk-0')?.trashedAt).toEqual(expect.any(Number));
});

test('a full sync keeps a metadata-less hidden key that is already indexed', async () => {
    const items = [chunkItem(0)];
    const counts = emptyCounts();
    const coldFetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });
    const cold = await syncWith(coldFetcher);

    const hiddenFetcher = fetcherFor(
        [],
        [pageBytes([], '', { syncToken: SYNC_TWO, trashed: ['chunk-0'] })],
        counts,
        {
            delta: pageBytes([], '', { syncToken: 'sync-three' })
        }
    );
    await syncWith(hiddenFetcher, cold.unwrap().revision, true);

    expect(readAccountState(EMAIL)?.items.get('chunk-0')?.trashedAt).toEqual(expect.any(Number));
});

test('a paged listing fills a metadata-less hidden key from the index', async () => {
    const items = [chunkItem(0)];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });
    await syncWith(fetcher);

    const state = readAccountState(EMAIL);
    const item = state?.items.get('chunk-0');
    if (!state || !item) throw new Error('Missing indexed chunk');
    state.items.set('chunk-0', { ...item, trashedAt: 123 });

    const hiddenFetcher = fetcherFor([], [pageBytes([], '', { trashed: ['chunk-0'] })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });
    const page = await listBmps(EMAIL, TOKEN, '', hiddenFetcher);

    expect(page.unwrap().items).toContainEqual(
        expect.objectContaining({ mediaKey: 'chunk-0', trashedAt: 123 })
    );
});

test('a full sync keeps the known trash timestamp', async () => {
    const hidden = chunkItem(0);
    const counts = emptyCounts();
    const page = pageBytes([], '', { syncToken: SYNC_ONE, trashed: [hidden] });
    const fetcher = fetcherFor([hidden], [page], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const cold = await syncWith(fetcher);
    const state = readAccountState(EMAIL);
    const item = state?.items.get('chunk-0');
    if (!state || !item) throw new Error('Missing hidden chunk state');
    state.items.set('chunk-0', { ...item, trashedAt: 123 });

    await syncWith(fetcher, cold.unwrap().revision, true);

    expect(readAccountState(EMAIL)?.items.get('chunk-0')?.trashedAt).toBe(123);
});
