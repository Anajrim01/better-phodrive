import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { scanLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { Err, Ok } from 'results-ts';
import { expect, test, vi } from 'vitest';
import { fileChunk, listingPage, type BudgetItem } from '../helpers/library-budget';
import { budgetFetcher, emptyCounts } from '../helpers/library-budget-fetcher';
import { memoryStore, type MemoryStore } from '../helpers/library-budget-store';

const EMAIL = 'copies@example.com';
const TOKEN = 'aas_et/copies';
const HEADERS = { commonHeaders: {}, rpcHeaders: {} } as unknown as Parameters<
    typeof scanLibraryPage
>[1];

function candidate(item: BudgetItem) {
    return {
        mediaKey: item.mediaKey,
        sha1: item.sha1,
        size: item.size,
        at: item.at,
        ...(item.trashed ? { trashed: true } : {})
    };
}

async function readAll(store: MemoryStore, fetcher: Fetcher): Promise<RemoteBmp[]> {
    const items = new Map<string, RemoteBmp>();
    const coordinator = createThrottleCoordinator(() => 0);
    let token = '';

    do {
        const page = (
            await listBmps(EMAIL, TOKEN, token, fetcher, store, {
                key: 'account-a',
                coordinator
            })
        ).unwrap();
        for (const item of page.items) items.set(item.mediaKey, item);
        token = page.nextPageToken;
    } while (token);

    return [...items.values()];
}

function copies(folder?: string): BudgetItem[] {
    return [
        fileChunk('copy-a', 0, true, Uint8Array.of(1, 2, 3, 4), {
            at: 1,
            name: 'copy.bin',
            ...(folder ? { folder } : {})
        }),
        fileChunk('copy-b', 0, true, Uint8Array.of(1, 2, 3, 4), {
            at: 2,
            name: 'copy.bin',
            ...(folder ? { folder } : {})
        }),
        fileChunk('copy-c', 0, true, Uint8Array.of(1, 2, 3, 4), {
            at: 3,
            name: 'copy.bin',
            ...(folder ? { folder } : {})
        })
    ];
}

test('three identical stored copies share one PrepareDownload and one range GET', async () => {
    const items = copies();
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage(items)]]), items, counts),
        store,
        { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) }
    );
    const returned = result.unwrap().items;

    expect(returned).toHaveLength(3);
    expect(new Set(returned.map((item) => item.mediaKey))).toEqual(
        new Set(['copy-a', 'copy-b', 'copy-c'])
    );
    expect(returned.map((item) => item.at)).toEqual([1, 2, 3]);
    expect(new Set(returned.map((item) => item.fileId)).size).toBe(1);
    expect(returned.every((item) => item.originalName === 'copy.bin')).toBe(true);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 1, media: 1 });
    expect(store.rows.size).toBe(3);
});

test('an indexed copy lets an identical cold copy skip both Google requests', async () => {
    const [first, second] = copies();
    const store = memoryStore();
    await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage([first])]]), [first], emptyCounts()),
        store,
        { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) }
    );

    const counts = emptyCounts();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage([first, second])]]), [first, second], counts),
        store,
        { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) }
    );

    expect(result.unwrap().items).toHaveLength(2);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 0, media: 0 });
    expect(store.rows.size).toBe(2);
});

test('identical foldered copies share one probe and keep the folder', async () => {
    const items = copies('Projects/2026');
    const counts = emptyCounts();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage(items)]]), items, counts),
        memoryStore(),
        { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) }
    );

    expect(result.unwrap().items).toHaveLength(3);
    expect(result.unwrap().items.every((item) => item.folder === 'Projects/2026')).toBe(true);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 1, media: 1 });
});

test('identical copies on separate pages probe once on each page', async () => {
    const [first, second] = copies();
    const counts = emptyCounts();
    const store = memoryStore();
    const pages = new Map([
        ['', listingPage([first], 'page-2')],
        ['page-2', listingPage([second])]
    ]);
    const result = await readAll(store, budgetFetcher(pages, [first, second], counts));

    expect(result).toHaveLength(2);
    expect(counts).toEqual({ auth: 2, library: 3, prepare: 2, media: 2 });
    expect(store.rows.size).toBe(2);
});

test('a throttled duplicate group pauses only its account', async () => {
    const items = copies();
    const candidates = items.map(candidate);
    const coordinator = createThrottleCoordinator(() => 0);
    const fetcher = vi.fn<Fetcher>(
        async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })
    );
    const result = await scanLibraryPage(
        { items: candidates, nextPageToken: '' },
        HEADERS,
        fetcher,
        undefined,
        { key: 'account-a', coordinator }
    );

    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(coordinator.remaining('account-a')).toBeGreaterThan(0);
    expect(coordinator.remaining('account-b')).toBe(0);
});

test('a metadata save failure keeps every copy and reports the warning', async () => {
    const items = copies();
    const store = memoryStore();
    store.save = () =>
        Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.METADATA_SAVE_FAILED));
    const counts = emptyCounts();
    const result = await scanLibraryPage(
        { items: items.map(candidate), nextPageToken: '' },
        HEADERS,
        budgetFetcher(new Map([['', Buffer.alloc(0)]]), items, counts),
        store,
        { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) }
    );
    const page = result.unwrap();

    expect(page.items).toHaveLength(3);
    expect(page.warnings).toContainEqual({ code: 'METADATA_SAVE_FAILED' });
    expect(counts).toEqual({ auth: 0, library: 0, prepare: 1, media: 1 });
});
