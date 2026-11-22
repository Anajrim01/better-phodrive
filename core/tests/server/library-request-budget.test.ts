import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import {
    createThrottleCoordinator,
    type ThrottleCoordinator,
    type ThrottleScope
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { expect, test } from 'vitest';
import { fileChunk as chunk, listingPage, type BudgetItem } from '../helpers/library-budget';
import { budgetFetcher, emptyCounts, type RequestCounts } from '../helpers/library-budget-fetcher';
import { memoryStore } from '../helpers/library-budget-store';

const EMAIL = 'budget@example.com';
const TOKEN = 'aas_et/budget';

function throttle(): ThrottleCoordinator {
    return createThrottleCoordinator(() => 0);
}

function scope(coordinator = throttle()): ThrottleScope {
    return { key: 'account-a', coordinator };
}

async function readAll(
    store: ReturnType<typeof memoryStore>,
    fetcher: Fetcher,
    throttleScope: ThrottleScope
): Promise<RemoteBmp[]> {
    const items = new Map<string, RemoteBmp>();
    let token = '';

    do {
        const page = (await listBmps(EMAIL, TOKEN, token, fetcher, store, throttleScope)).unwrap();
        for (const item of page.items) items.set(item.mediaKey, item);
        token = page.nextPageToken;
    } while (token);

    return [...items.values()];
}

function singlePageFetcher(items: readonly BudgetItem[], counts: RequestCounts): Fetcher {
    return budgetFetcher(new Map([['', listingPage(items)]]), items, counts);
}

function expectCounts(counts: RequestCounts, expected: RequestCounts): void {
    expect({
        auth: counts.auth,
        library: counts.library,
        prepare: counts.prepare,
        media: counts.media
    }).toEqual(expected);
}

test('a cold root single-chunk file costs one PrepareDownload and one range GET', async () => {
    const item = chunk('root-one', 0, true, Uint8Array.of(1, 2, 3), { name: 'root.bin' });
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher([item], counts),
        store,
        scope()
    );

    expect(result.unwrap().items).toEqual([expect.objectContaining({ mediaKey: 'root-one' })]);
    expectCounts(counts, { auth: 1, library: 1, prepare: 1, media: 1 });
    expect(store.saves).toBe(1);
    expect(store.rows.size).toBe(1);
});

test('a cold foldered single-chunk file costs the same requests and keeps its folder', async () => {
    const item = chunk('folder-one', 0, true, Uint8Array.of(1, 2, 3), {
        name: 'folder.bin',
        folder: 'Projects/2026'
    });
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher([item], counts),
        store,
        scope()
    );

    expect(result.unwrap().items[0]).toMatchObject({ folder: 'Projects/2026' });
    expectCounts(counts, { auth: 1, library: 1, prepare: 1, media: 1 });
});

test('a cold root multi-chunk file costs one probe per unique chunk', async () => {
    const items = [
        chunk('root-0', 0, false, Uint8Array.of(1, 1, 1), { name: 'multi.bin' }),
        chunk('root-1', 1, false, Uint8Array.of(2, 2, 2)),
        chunk('root-2', 2, true, Uint8Array.of(3, 3, 3))
    ];
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher(items, counts),
        store,
        scope()
    );

    expect(result.unwrap().items).toHaveLength(3);
    expectCounts(counts, { auth: 1, library: 1, prepare: 3, media: 3 });
    expect(store.rows.size).toBe(3);
});

test('a cold foldered multi-chunk file keeps the folder only on chunk 0', async () => {
    const items = [
        chunk('folder-0', 0, false, Uint8Array.of(1, 1, 1), {
            name: 'multi.bin',
            folder: 'Projects/2026'
        }),
        chunk('folder-1', 1, false, Uint8Array.of(2, 2, 2)),
        chunk('folder-2', 2, true, Uint8Array.of(3, 3, 3))
    ];
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher(items, counts),
        store,
        scope()
    );
    const byKey = new Map(result.unwrap().items.map((item) => [item.mediaKey, item]));

    expect(byKey.get('folder-0')?.folder).toBe('Projects/2026');
    expect(byKey.get('folder-1')?.folder).toBeUndefined();
    expect(byKey.get('folder-2')?.folder).toBeUndefined();
    expectCounts(counts, { auth: 1, library: 1, prepare: 3, media: 3 });
});

test('many unique cold candidates cost one probe each across pages', async () => {
    const first = Array.from({ length: 60 }, (_, index) =>
        chunk(`cold-${index}`, 0, true, Uint8Array.of(index + 1), {
            name: `cold-${index}.bin`
        })
    );
    const last = Array.from({ length: 40 }, (_, index) =>
        chunk(`cold-${index + 60}`, 0, true, Uint8Array.of(index + 61), {
            name: `cold-${index + 60}.bin`
        })
    );
    const items = [...first, ...last];
    const pages = new Map([
        ['', listingPage(first, 'page-2')],
        ['page-2', listingPage(last)]
    ]);
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await readAll(store, budgetFetcher(pages, items, counts), scope());

    expect(result).toHaveLength(100);
    expectCounts(counts, { auth: 2, library: 3, prepare: 100, media: 100 });
    expect(store.rows.size).toBe(100);
});

test('a repeat scan with a complete index makes no probes', async () => {
    const first = Array.from({ length: 60 }, (_, index) =>
        chunk(`warm-${index}`, 0, true, Uint8Array.of(index + 1), {
            name: `warm-${index}.bin`
        })
    );
    const last = Array.from({ length: 40 }, (_, index) =>
        chunk(`warm-${index + 60}`, 0, true, Uint8Array.of(index + 61), {
            name: `warm-${index + 60}.bin`
        })
    );
    const items = [...first, ...last];
    const pages = new Map([
        ['', listingPage(first, 'page-2')],
        ['page-2', listingPage(last)]
    ]);
    const store = memoryStore();
    const coldCounts = emptyCounts();

    await readAll(store, budgetFetcher(pages, items, coldCounts), scope());

    const warmCounts = emptyCounts();
    const warm = await readAll(store, budgetFetcher(pages, items, warmCounts), scope());

    expect(warm).toHaveLength(100);
    expectCounts(warmCounts, { auth: 2, library: 3, prepare: 0, media: 0 });
});

test('one changed chunk among indexed candidates probes only that chunk', async () => {
    const items = Array.from({ length: 10 }, (_, index) =>
        chunk(`stale-${index}`, 0, true, Uint8Array.of(index + 1, 7), {
            name: `stale-${index}.bin`
        })
    );
    const store = memoryStore();
    const counts = emptyCounts();

    await listBmps(EMAIL, TOKEN, '', singlePageFetcher(items, counts), store, scope());

    const changed = items.map((item, index) =>
        index === 0
            ? chunk('stale-0', 0, true, Uint8Array.of(9, 9, 9), { name: 'stale-0.bin' })
            : item
    );
    const refreshCounts = emptyCounts();

    const refreshed = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher(changed, refreshCounts),
        store,
        scope()
    );

    expect(refreshed.unwrap().items).toHaveLength(10);
    expectCounts(refreshCounts, { auth: 1, library: 1, prepare: 1, media: 1 });
});

test('mixed indexed and cold candidates probe only the cold candidates', async () => {
    const indexed = Array.from({ length: 10 }, (_, index) =>
        chunk(`mixed-${index}`, 0, true, Uint8Array.of(index + 1, 3), {
            name: `mixed-${index}.bin`
        })
    );
    const cold = Array.from({ length: 5 }, (_, index) =>
        chunk(`mixed-${index + 10}`, 0, true, Uint8Array.of(index + 21, 4), {
            name: `mixed-${index + 10}.bin`
        })
    );
    const store = memoryStore();
    await listBmps(EMAIL, TOKEN, '', singlePageFetcher(indexed, emptyCounts()), store, scope());

    const counts = emptyCounts();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        singlePageFetcher([...indexed, ...cold], counts),
        store,
        scope()
    );

    expect(result.unwrap().items).toHaveLength(15);
    expectCounts(counts, { auth: 1, library: 1, prepare: 5, media: 5 });
});
