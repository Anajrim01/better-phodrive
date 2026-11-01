import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { listBmps, syncLibrary } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import {
    LIBRARY_STATE_LOG_LIMIT,
    clearLibraryState,
    configureLibraryState,
    flushLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import {
    SYNC_ONE,
    SYNC_TWO,
    chunkItem,
    emptyCounts,
    fetcherFor,
    pageBytes
} from '../helpers/delta-library';

const EMAIL = 'cursor@example.com';
const TOKEN = 'aas_et/cursor';

let folder = '';

function remote(mediaKey: string): RemoteBmp {
    return {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        size: 1,
        at: 1,
        mediaKey,
        sha1: 'c'.repeat(40)
    };
}

function syncWith(fetcher: Parameters<typeof syncLibrary>[4], revision = 0, force = false) {
    return syncLibrary(EMAIL, TOKEN, force, revision, fetcher);
}

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-cursor-'));
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

test('a second client receives changes consumed by the first', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const options = {
        delta: pageBytes([items[0]], '', { syncToken: SYNC_TWO })
    };
    const fetcher = fetcherFor(
        items,
        [pageBytes(items, '', { syncToken: SYNC_ONE })],
        counts,
        options
    );

    const cold = await syncWith(fetcher);
    const revision = cold.unwrap().revision;

    const first = await syncWith(fetcher, revision);
    options.delta = pageBytes([], '', { syncToken: 'sync-three' });
    const second = await syncWith(fetcher, revision);

    expect(first.unwrap().items.map((item) => item.mediaKey)).toEqual(['chunk-0']);
    expect(second.unwrap().items.map((item) => item.mediaKey)).toEqual(['chunk-0']);
    expect(second.unwrap().revision).toBe(first.unwrap().revision);
    expect(counts.delta).toBe(2);
});

test('missing state or missing cursor returns a full index', async () => {
    const items = Array.from({ length: 40 }, (_, index) => chunkItem(index));
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, [pageBytes(items, '', { syncToken: SYNC_ONE })], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const first = await syncWith(fetcher);
    expect(first.unwrap().full).toBe(true);

    const missingCursor = await syncWith(fetcher, 0);
    expect(missingCursor.unwrap().full).toBe(true);
    expect(missingCursor.unwrap().items).toHaveLength(40);
    expect(missingCursor.unwrap().revision).toBe(first.unwrap().revision);
});

test('the paged endpoint reports the stored revision', async () => {
    writeAccountState(EMAIL, {
        syncToken: Buffer.from(SYNC_ONE),
        revision: 7,
        items: new Map([['chunk-0', remote('chunk-0')]]),
        log: []
    });
    const counts = emptyCounts();
    const fetcher = fetcherFor([], [pageBytes([], '')], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const page = await listBmps(EMAIL, TOKEN, '', fetcher);

    expect(page.unwrap().revision).toBe(7);
    expect(page.unwrap().items).toEqual([]);
});

test('a client behind the change log gets a full index', async () => {
    const state = {
        syncToken: Buffer.from(SYNC_ONE),
        revision: LIBRARY_STATE_LOG_LIMIT + 9,
        items: new Map([['chunk-0', remote('chunk-0')]]),
        log: Array.from({ length: LIBRARY_STATE_LOG_LIMIT }, (_, index) => ({
            revision: index + 10,
            at: Date.now(),
            items: [],
            deleted: []
        }))
    };
    writeAccountState(EMAIL, state);
    const counts = emptyCounts();
    const fetcher = fetcherFor([], [], counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });

    const result = await syncWith(fetcher, 1);

    expect(result.unwrap().full).toBe(true);
    expect(result.unwrap().items.map((item) => item.mediaKey)).toEqual(['chunk-0']);
    expect(result.unwrap().revision).toBe(state.revision);
});

test('accounts keep independent revision and state in one file', () => {
    writeAccountState('first@example.com', {
        syncToken: Buffer.from('token-first'),
        revision: 7,
        items: new Map([['chunk-0', remote('chunk-0')]]),
        log: [{ revision: 7, at: Date.now(), items: [], deleted: ['chunk-0'] }]
    });
    writeAccountState('second@example.com', {
        syncToken: Buffer.from('token-second'),
        revision: 9,
        items: new Map([['chunk-1', remote('chunk-1')]]),
        log: []
    });
    flushLibraryState();
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));

    expect(readAccountState('first@example.com')?.syncToken.toString()).toBe('token-first');
    expect(readAccountState('second@example.com')?.syncToken.toString()).toBe('token-second');
    expect(readAccountState('first@example.com')?.revision).toBe(7);
    expect(readAccountState('second@example.com')?.revision).toBe(9);
    expect(readAccountState('first@example.com')?.items.has('chunk-0')).toBe(true);
    expect(readAccountState('second@example.com')?.items.has('chunk-1')).toBe(true);
    expect(readAccountState('first@example.com')?.items.has('chunk-1')).toBe(false);
    expect(readAccountState('first@example.com')?.log).toHaveLength(1);
    expect(readAccountState('first@example.com')?.log[0]?.deleted).toEqual(['chunk-0']);
});
