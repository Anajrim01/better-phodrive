import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import type { LibraryCandidate } from '@madkarmaa/phodrive-core/server/photos/library/metadata';
import {
    clearProbeCache,
    configureProbeCache,
    flushProbeCache,
    readProbe,
    writeProbe
} from '@madkarmaa/phodrive-core/server/photos/library/probe-cache';

const EMAIL = 'cache@example.com';
const CANDIDATE: LibraryCandidate = {
    size: 1_000,
    at: 1,
    mediaKey: 'media-key',
    sha1: 'a'.repeat(40),
    trashed: false
};
const ITEM: RemoteBmp = {
    fileHash: 'b'.repeat(64),
    fileId: 'c'.repeat(64),
    chunkIndex: 0,
    isLast: true,
    originalName: 'cached.bin',
    size: 12,
    at: 1,
    mediaKey: 'media-key',
    sha1: 'a'.repeat(40)
};

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-probe-'));
    clearProbeCache();
    configureProbeCache(join(folder, 'probe-cache.json'));
});

afterEach(async () => {
    configureProbeCache(null);
    clearProbeCache();
    await rm(folder, { recursive: true, force: true });
});

test('a cold process reuses persisted probes', () => {
    writeProbe(EMAIL, CANDIDATE, ITEM);
    flushProbeCache();

    clearProbeCache();
    configureProbeCache(join(folder, 'probe-cache.json'));

    expect(readProbe(EMAIL, CANDIDATE)).toEqual(ITEM);
});

test('a positive probe never expires', () => {
    writeProbe(EMAIL, CANDIDATE, ITEM, 0);

    expect(readProbe(EMAIL, CANDIDATE, 400 * 24 * 60 * 60 * 1_000)).toEqual(ITEM);
});

test('a negative probe expires after one hour', () => {
    writeProbe(EMAIL, CANDIDATE, null, 0);

    expect(readProbe(EMAIL, CANDIDATE, 59 * 60 * 1_000)).toBeNull();
    expect(readProbe(EMAIL, CANDIDATE, 61 * 60 * 1_000)).toBeUndefined();
});

test('full cache rewrites are spaced thirty seconds apart', { timeout: 15_000 }, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    try {
        writeProbe(EMAIL, { ...CANDIDATE, mediaKey: 'first' }, { ...ITEM, mediaKey: 'first' });
        await vi.advanceTimersByTimeAsync(1_000);

        const first = JSON.parse(await readFile(join(folder, 'probe-cache.json'), 'utf8')) as {
            entries: unknown[];
        };
        expect(first.entries).toHaveLength(1);

        writeProbe(EMAIL, { ...CANDIDATE, mediaKey: 'second' }, { ...ITEM, mediaKey: 'second' });
        await vi.advanceTimersByTimeAsync(1_000);

        const early = JSON.parse(await readFile(join(folder, 'probe-cache.json'), 'utf8')) as {
            entries: unknown[];
        };
        expect(early.entries).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(29_000);

        const later = JSON.parse(await readFile(join(folder, 'probe-cache.json'), 'utf8')) as {
            entries: unknown[];
        };
        expect(later.entries).toHaveLength(2);
    } finally {
        vi.useRealTimers();
    }
});

test('a corrupt cache file is ignored', async () => {
    await writeFile(join(folder, 'probe-cache.json'), '{ broken');

    configureProbeCache(join(folder, 'probe-cache.json'));

    expect(readProbe(EMAIL, CANDIDATE)).toBeUndefined();
});
