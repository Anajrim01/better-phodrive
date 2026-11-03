import { beforeEach, expect, test } from 'vitest';
import { readLibrary } from '@madkarmaa/phodrive-core/node/library';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    emptyCounts,
    fetcherFor,
    fileChunk,
    pageBytes,
    pagesOf,
    type Item
} from '../helpers/delta-library';

const EMAIL = 'budget-multi@example.com';
const TOKEN = 'aas_et/budget-multi';
const ITEM_COUNT = 5_000;
const PAGE_COUNT = ITEM_COUNT / 200;

beforeEach(() => {
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
});

function fetcher(items: readonly Item[]) {
    const counts = emptyCounts();

    return {
        counts,
        fetcher: fetcherFor(items, pagesOf(items), counts, { delta: pageBytes([], '') })
    };
}

test('one 5,000-chunk logical file still costs one probe per unique chunk', async () => {
    const items = Array.from({ length: ITEM_COUNT }, (_, index) => fileChunk(0, index, ITEM_COUNT));
    const { counts, fetcher: read } = fetcher(items);

    const library = await readLibrary(EMAIL, TOKEN, read);

    expect(library.unwrap()).toHaveLength(1);
    expect(library.unwrap()[0]?.chunks).toHaveLength(ITEM_COUNT);
    expect(library.unwrap()[0]?.complete).toBe(true);
    expect(counts).toEqual({
        auth: 1,
        page: PAGE_COUNT,
        delta: 0,
        prepare: ITEM_COUNT,
        range: ITEM_COUNT
    });
}, 60_000);

test('5,000 chunks spread across many files still cost one probe per unique chunk', async () => {
    const items = Array.from({ length: 500 }, (_, fileIndex) =>
        Array.from({ length: 10 }, (_, chunkIndex) => fileChunk(fileIndex, chunkIndex, 10))
    ).flat();
    const { counts, fetcher: read } = fetcher(items);

    const library = await readLibrary(EMAIL, TOKEN, read);

    expect(library.unwrap()).toHaveLength(500);
    expect(library.unwrap().every((file) => file.chunks.length === 10)).toBe(true);
    expect(counts).toEqual({
        auth: 1,
        page: PAGE_COUNT,
        delta: 0,
        prepare: ITEM_COUNT,
        range: ITEM_COUNT
    });
}, 60_000);

test('the same name and file hash in two folders cost two probes and stay separate', async () => {
    const first = fileChunk(0, 0, 1, 'photos/a');
    const second = { ...fileChunk(0, 0, 1, 'photos/b'), mediaKey: 'folder-b' };
    const items = [first, second];
    const { counts, fetcher: read } = fetcher(items);

    const library = await readLibrary(EMAIL, TOKEN, read);
    const files = library.unwrap();

    expect(files).toHaveLength(2);
    expect(files.map((file) => file.folder).sort()).toEqual(['photos/a', 'photos/b']);
    expect(new Set(files.map((file) => file.fileId)).size).toBe(2);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 2, range: 2 });
});

test('the same name, folder, and bytes cost one probe', async () => {
    const first = fileChunk(0, 0, 1, 'photos/a');
    const second = { ...first, mediaKey: 'copy-b', at: first.at + 1 };
    const { counts, fetcher: read } = fetcher([first, second]);

    const library = await readLibrary(EMAIL, TOKEN, read);
    const files = library.unwrap();

    expect(new Set(files.map((file) => file.fileId)).size).toBe(1);
    expect(files.every((file) => file.folder === 'photos/a')).toBe(true);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 1, range: 1 });
});
