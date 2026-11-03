import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearProbeCache,
    configureProbeCache,
    flushProbeCache
} from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    DOWNLOAD_HOST,
    fetcherFor,
    fixture,
    libraryPage,
    type ProbeCounts
} from '../helpers/library';

const EMAIL = 'cross-page@example.com';
const TOKEN = 'aas_et/cross-page';

beforeEach(() => {
    clearProbeCache();
    clearThrottleState();
});

test('an identical stored copy on a later page reuses the first content probe', async () => {
    const file = fixture('note.txt', 'cross page probe content');
    const fileHash = 'a'.repeat(64);
    const first = {
        ...file,
        fileName: `note.txt.phodrive-${fileHash}-0-of-1.bmp`
    };
    const second = {
        ...file,
        mediaKey: 'second-page-key',
        at: 2,
        fileName: `note.txt.phodrive-${fileHash}-0-of-2.bmp`
    };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const prepared = {
        mediaKey: first.mediaKey,
        sha1: first.sha1,
        url: `${DOWNLOAD_HOST}/photo`
    };
    const firstPage = await listBmps(
        EMAIL,
        TOKEN,
        '',
        fetcherFor(
            libraryPage([first], 'next-page'),
            prepared,
            () => new Response(file.bmp),
            counts
        )
    );
    const secondPage = await listBmps(
        EMAIL,
        TOKEN,
        firstPage.unwrap().nextPageToken,
        fetcherFor(libraryPage([second]), prepared, () => new Response(file.bmp), counts)
    );

    expect(counts).toEqual({ prepare: 1, range: 1 });
    expect(secondPage.unwrap().items).toHaveLength(1);
    expect(secondPage.unwrap().items[0]).toMatchObject({
        mediaKey: second.mediaKey,
        at: second.at,
        chunkCount: 2,
        originalName: 'note.txt'
    });
});

test('content probes survive a process-style cache reload', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'phodrive-content-cache-'));
    const cacheFile = join(folder, 'probe-cache.json');
    const file = fixture('note.txt', 'persisted content cache');
    const fileHash = 'b'.repeat(64);
    const first = {
        ...file,
        fileName: `note.txt.phodrive-${fileHash}-0-of-1.bmp`
    };
    const second = {
        ...file,
        mediaKey: 'after-reload-key',
        at: 2,
        fileName: `note.txt.phodrive-${fileHash}-0-of-2.bmp`
    };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const prepared = {
        mediaKey: first.mediaKey,
        sha1: first.sha1,
        url: `${DOWNLOAD_HOST}/photo`
    };

    try {
        configureProbeCache(cacheFile);
        await listBmps(
            EMAIL,
            TOKEN,
            '',
            fetcherFor(libraryPage([first]), prepared, () => new Response(file.bmp), counts)
        );
        expect(counts).toEqual({ prepare: 1, range: 1 });

        flushProbeCache();
        clearProbeCache();
        configureProbeCache(cacheFile);

        const reloaded = await listBmps(
            EMAIL,
            TOKEN,
            '',
            fetcherFor(libraryPage([second]), prepared, () => new Response(file.bmp), counts)
        );

        expect(counts).toEqual({ prepare: 1, range: 1 });
        expect(reloaded.unwrap().items[0]).toMatchObject({
            mediaKey: second.mediaKey,
            at: second.at,
            chunkCount: 2,
            originalName: 'note.txt'
        });
    } finally {
        configureProbeCache(null);
        clearProbeCache();
        await rm(folder, { recursive: true, force: true });
    }
});
