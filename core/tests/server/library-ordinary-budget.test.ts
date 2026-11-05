import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import {
    createThrottleCoordinator,
    type ThrottleScope
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { expect, test } from 'vitest';
import { budgetItem, listingPage } from '../helpers/library-budget';
import { budgetFetcher, emptyCounts } from '../helpers/library-budget-fetcher';
import { memoryStore } from '../helpers/library-budget-store';

const EMAIL = 'ordinary@example.com';
const TOKEN = 'aas_et/ordinary';

function scope(): ThrottleScope {
    return { key: 'account-a', coordinator: createThrottleCoordinator(() => 0) };
}

test('ordinary photos whose size cannot be a split BMP make no Google requests', async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
        budgetItem({
            mediaKey: `ordinary-${index}`,
            size: 3126 + index,
            bmp: Buffer.alloc(3126),
            remoteName: `ordinary-${index}.jpg`
        })
    );
    const counts = emptyCounts();
    const store = memoryStore();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage(items)]]), items, counts),
        store,
        scope()
    );

    expect(result.unwrap().items).toEqual([]);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 1, media: 1 });
    expect(store.saves).toBe(0);
});

test('an ordinary photo with a possible split size is still probed', async () => {
    const item = budgetItem({
        mediaKey: 'ordinary-photo',
        size: 3126,
        bmp: Buffer.alloc(3126),
        remoteName: 'ordinary.jpg'
    });
    const counts = emptyCounts();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage([item])]]), [item], counts),
        memoryStore(),
        scope()
    );

    expect(result.unwrap().items).toEqual([]);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 1, media: 1 });
});

test('an ordinary video costs one PrepareDownload and no range GET', async () => {
    const item = budgetItem({
        mediaKey: 'ordinary-video',
        size: 3126,
        bmp: Buffer.alloc(3126),
        remoteName: 'ordinary.mp4',
        video: true
    });
    const counts = emptyCounts();
    const result = await listBmps(
        EMAIL,
        TOKEN,
        '',
        budgetFetcher(new Map([['', listingPage([item])]]), [item], counts),
        memoryStore(),
        scope()
    );

    expect(result.unwrap().items).toEqual([]);
    expect(counts).toEqual({ auth: 1, library: 1, prepare: 1, media: 0 });
});
