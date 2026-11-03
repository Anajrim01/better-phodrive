import { beforeEach, expect, test } from 'vitest';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    DOWNLOAD_HOST,
    fetcherFor,
    fixture,
    libraryPage,
    type ProbeCounts
} from '../helpers/library';

const EMAIL = 'duplicates@example.com';
const TOKEN = 'aas_et/duplicates';

beforeEach(() => {
    clearProbeCache();
    clearThrottleState();
});

test('identical stored copies share one header probe and keep their own media keys', async () => {
    const file = fixture('note.txt', 'duplicate probe content');
    const marker = `note.txt.phodrive-${file.sha1}-0-of-1.bmp`;
    const first = { ...file, fileName: marker };
    const second = { ...file, mediaKey: 'duplicate-key', at: 2, fileName: marker };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([first, second]),
        { mediaKey: first.mediaKey, sha1: first.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.mediaKey)).toEqual([first.mediaKey, second.mediaKey]);
    expect(items.every((item) => item.originalName === 'note.txt')).toBe(true);
    expect(items[0]?.fileId).toBe(items[1]?.fileId);
    expect(counts).toEqual({ prepare: 1, range: 1 });

    const warm = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;
    expect(warm).toHaveLength(2);
    expect(counts).toEqual({ prepare: 1, range: 1 });
});

test('identical stored copies keep their own filename chunk counts', async () => {
    const file = fixture('note.txt', 'duplicate chunk count content');
    const fileHash = 'a'.repeat(64);
    const first = {
        ...file,
        fileName: `note.txt.phodrive-${fileHash}-0-of-1.bmp`
    };
    const second = {
        ...file,
        mediaKey: 'duplicate-count-key',
        at: 2,
        fileName: `note.txt.phodrive-${fileHash}-0-of-2.bmp`
    };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([first, second]),
        { mediaKey: first.mediaKey, sha1: first.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;

    expect(counts).toEqual({ prepare: 1, range: 1 });
    expect(items.map((item) => item.chunkCount)).toEqual([1, 2]);
});
