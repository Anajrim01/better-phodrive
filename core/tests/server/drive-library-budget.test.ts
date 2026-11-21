import { listDrivePages } from '@madkarmaa/phodrive-core/server/photos';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { expect, test } from 'vitest';
import { budgetItem, fileChunk, listingPage } from '../helpers/library-budget';
import { budgetFetcher, emptyCounts } from '../helpers/library-budget-fetcher';
import { memoryStore } from '../helpers/library-budget-store';

const EMAIL = 'library@example.com';
const TOKEN = 'aas_et/library';

test('a photo-heavy listing returns within the probe budget and resumes at the next candidate', async () => {
    const ordinary = Array.from({ length: 20 }, (_, index) =>
        budgetItem({ mediaKey: `photo-${index}`, bmp: Buffer.alloc(3126, index) })
    );
    const file = fileChunk('phodrive-file', 0, true, Uint8Array.of(1, 2, 3, 4));
    const items = [...ordinary, file];
    const pages = new Map([['', listingPage(items)]]);
    const counts = emptyCounts();
    const fetcher = budgetFetcher(pages, items, counts);
    const store = memoryStore();
    const scope = { key: EMAIL, coordinator: createThrottleCoordinator(() => 0) };

    const first = (await listDrivePages(EMAIL, TOKEN, '', fetcher, store, scope)).unwrap();
    expect(first.items).toEqual([]);
    expect(first.nextPageToken).toBeTruthy();
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 16, media: 16 });

    const next = (
        await listDrivePages(EMAIL, TOKEN, first.nextPageToken, fetcher, store, scope)
    ).unwrap();
    expect(next.items.map((item) => item.mediaKey)).toEqual([file.mediaKey]);
    expect(next.nextPageToken).toBe('');
    expect(counts).toEqual({ auth: 2, library: 2, prepare: 21, media: 21 });

    pages.set('', listingPage(items.toReversed()));
    const changed = await listDrivePages(EMAIL, TOKEN, first.nextPageToken, fetcher, store, scope);
    expect(changed.unwrapErr().code).toBe('LIBRARY_PAGE_CHANGED');
    expect(counts.prepare).toBe(21);
});

test('a batch returns a continuation after the requested number of empty listings', async () => {
    const pages = new Map([
        ['', listingPage([], 'second')],
        ['second', listingPage([], 'third')],
        ['third', listingPage([])]
    ]);
    const counts = emptyCounts();
    const result = (
        await listDrivePages(
            EMAIL,
            TOKEN,
            '',
            budgetFetcher(pages, [], counts),
            undefined,
            undefined,
            2
        )
    ).unwrap();

    expect(result.items).toEqual([]);
    expect(result.pageTokens).toHaveLength(2);
    expect(result.nextPageToken).toBe(Buffer.from('third').toString('base64url'));
    expect(counts).toEqual({ auth: 1, library: 2, prepare: 0, media: 0 });
});

test('resuming a listing can identify a trashed copy using an earlier indexed file', async () => {
    const file = fileChunk('original', 0, true, Uint8Array.of(1, 2, 3, 4));
    const ordinary = Array.from({ length: 16 }, (_, index) =>
        budgetItem({ mediaKey: `photo-${index}`, bmp: Buffer.alloc(3126, index) })
    );
    const trash = budgetItem({ mediaKey: 'trashed-copy', bmp: file.bmp, trashed: true });
    const items = [file, ...ordinary, trash];
    const counts = emptyCounts();
    const fetcher = budgetFetcher(new Map([['', listingPage(items)]]), items, counts);
    const store = memoryStore();

    const first = (await listDrivePages(EMAIL, TOKEN, '', fetcher, store)).unwrap();
    expect(first.items.map((item) => item.mediaKey)).toEqual([file.mediaKey]);
    const next = (await listDrivePages(EMAIL, TOKEN, first.nextPageToken, fetcher, store)).unwrap();
    expect(next.items).toMatchObject([{ mediaKey: trash.mediaKey, trashed: true }]);
    expect(next.nextPageToken).toBe('');
    expect(counts.prepare).toBe(17);
});
