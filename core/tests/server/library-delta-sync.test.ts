import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { syncLibrary } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import {
    clearLibraryState,
    configureLibraryState,
    flushLibraryState,
    readAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    SYNC_ONE,
    SYNC_TWO,
    chunkItem,
    emptyCounts,
    fetcherFor,
    pageBytes,
    pagesOf
} from '../helpers/delta-library';

const EMAIL = 'delta@example.com';
const TOKEN = 'aas_et/delta';
const ITEM_COUNT = 5_000;
const PAGE_COUNT = ITEM_COUNT / 200;

let folder = '';

function syncWith(fetcher: Parameters<typeof syncLibrary>[4], revision = 0, force = false) {
    return syncLibrary(EMAIL, TOKEN, force, revision, fetcher);
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-delta-'));
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

test('a full sync stores the index and a quiet warm refresh is one delta call', async () => {
    const items = Array.from({ length: ITEM_COUNT }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const delta = pageBytes([], '', { syncToken: SYNC_TWO });
    const fetcher = fetcherFor(items, pagesOf(items), counts, { delta });

    const cold = await syncWith(fetcher);
    const revision = cold.unwrap().revision;
    expect(cold.unwrap()).toMatchObject({ full: true, deleted: [] });
    expect(cold.unwrap().items).toHaveLength(ITEM_COUNT);
    expect(counts).toEqual({
        auth: 1,
        page: PAGE_COUNT,
        delta: 0,
        prepare: ITEM_COUNT,
        range: ITEM_COUNT
    });

    flushLibraryState();
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));

    counts.auth = 0;
    counts.page = 0;
    counts.prepare = 0;
    counts.range = 0;
    const warm = await syncWith(fetcher, revision);

    expect(warm.unwrap()).toEqual({ items: [], deleted: [], full: false, revision });
    expect(counts).toEqual({
        auth: 0,
        page: 0,
        delta: 1,
        prepare: 0,
        range: 0
    });
}, 60_000);

test('delta deletions remove indexed chunks', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, deleted: ['chunk-0'] })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);

    expect(warm.unwrap().deleted).toEqual(['chunk-0']);
    expect(readAccountState(EMAIL)?.items.has('chunk-0')).toBe(false);
    expect(readAccountState(EMAIL)?.items.size).toBe(39);
});

test('a chunk renamed without the marker is removed by the delta', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([{ ...items[0], fileName: 'renamed.jpg' }], '', {
            syncToken: SYNC_TWO
        })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);

    expect(warm.unwrap().deleted).toEqual(['chunk-0']);
    expect(readAccountState(EMAIL)?.items.has('chunk-0')).toBe(false);
});

test('a trashed chunk in a delta is removed from the index', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO, trashed: ['chunk-0'] })
    });

    const cold = await syncWith(fetcher);
    const warm = await syncWith(fetcher, cold.unwrap().revision);

    expect(warm.unwrap().deleted).toEqual(['chunk-0']);
    expect(readAccountState(EMAIL)?.items.has('chunk-0')).toBe(false);
});

test('a 429 delta propagates without a full re-crawl', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const options = {
        delta: pageBytes([], '', { syncToken: SYNC_TWO }),
        deltaStatus: undefined as number | undefined
    };
    const fetcher = fetcherFor(
        items,
        [pageBytes(items, '', { syncToken: SYNC_ONE })],
        counts,
        options
    );

    const cold = await syncWith(fetcher);
    options.deltaStatus = 429;
    counts.page = 0;
    counts.prepare = 0;
    counts.range = 0;

    const throttled = await syncWith(fetcher, cold.unwrap().revision);

    expect(throttled.unwrapErr().code).toBe('THROTTLED');
    expect(counts).toMatchObject({ page: 0, delta: 1, prepare: 0, range: 0 });
    expect(readAccountState(EMAIL)?.syncToken.toString()).toBe(SYNC_ONE);
});

test('a probe 404 during a delta does not trigger a full re-crawl', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const changed = chunkItem(100);
    const counts = emptyCounts();
    const options = {
        delta: pageBytes([changed], '', { syncToken: SYNC_TWO }),
        prepareStatus: undefined as number | undefined
    };
    const fetcher = fetcherFor(
        [...items, changed],
        [pageBytes(items, '', { syncToken: SYNC_ONE })],
        counts,
        options
    );

    const cold = await syncWith(fetcher);
    options.prepareStatus = 404;
    counts.page = 0;
    counts.delta = 0;
    counts.prepare = 0;
    counts.range = 0;

    const failed = await syncWith(fetcher, cold.unwrap().revision);

    expect(failed.unwrapErr()).toMatchObject({ code: 'REQUEST_FAILED', status: 404 });
    expect(counts).toMatchObject({ page: 0, delta: 1, prepare: 1, range: 0 });
    expect(readAccountState(EMAIL)?.syncToken.toString()).toBe(SYNC_ONE);
});

test('a rejected token falls back to a full sync', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO }),
        deltaStatus: 400
    });

    const cold = await syncWith(fetcher);
    counts.delta = 0;
    counts.page = 0;
    counts.prepare = 0;
    counts.range = 0;

    const recovered = await syncWith(fetcher, cold.unwrap().revision);

    expect(recovered.unwrap().full).toBe(true);
    expect(recovered.unwrap().revision).toBe(cold.unwrap().revision + 1);
    expect(counts).toMatchObject({
        page: 1,
        delta: 1,
        prepare: 0,
        range: 0
    });
});

test('a corrupt state file falls back to a full sync', async () => {
    await writeFile(join(folder, 'library-state.json'), '{ broken');
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const cold = await syncWith(fetcher);

    expect(cold.unwrap().full).toBe(true);
    expect(counts.page).toBe(1);
    expect(readAccountState(EMAIL)?.syncToken.toString()).toBe(SYNC_ONE);
});

test('a forced sync rebuilds from every page', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const cold = await syncWith(fetcher);
    counts.page = 0;
    counts.delta = 0;
    counts.prepare = 0;
    counts.range = 0;

    const forced = await syncWith(fetcher, cold.unwrap().revision, true);

    expect(forced.unwrap().full).toBe(true);
    expect(forced.unwrap().revision).toBe(cold.unwrap().revision + 1);
    expect(counts).toMatchObject({
        page: 1,
        delta: 0,
        prepare: 0,
        range: 0
    });
});
