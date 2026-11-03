import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { syncLibrary } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import {
    clearLibraryState,
    configureLibraryState,
    flushLibraryState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    SYNC_ONE,
    SYNC_TWO,
    emptyCounts,
    fetcherFor,
    fileChunk,
    pageBytes,
    pagesOf
} from '../helpers/delta-library';

const EMAIL = 'cold-scan-sync@example.com';
const TOKEN = 'aas_et/cold-scan-sync';

let stateFolder = '';

function items() {
    return Array.from({ length: 4 }, (_, fileIndex) =>
        Array.from({ length: 3 }, (_, chunkIndex) => fileChunk(fileIndex, chunkIndex, 3))
    ).flat();
}

beforeEach(async () => {
    stateFolder = await mkdtemp(join(tmpdir(), 'phodrive-cold-scan-sync-'));
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
    clearLibraryState();
    configureLibraryState(join(stateFolder, 'library-state.json'));
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    clearProbeCache();
    clearThrottleState();
    await rm(stateFolder, { recursive: true, force: true });
});

test('an incremental sync after a cold scan does not re-probe unchanged chunks', async () => {
    const chunks = items();
    const counts = emptyCounts();
    const coldFetcher = fetcherFor(chunks, pagesOf(chunks), counts, {
        delta: pageBytes([], '', { syncToken: SYNC_ONE })
    });

    const cold = await syncLibrary(EMAIL, TOKEN, false, 0, coldFetcher);
    expect(cold.unwrap().items).toHaveLength(chunks.length);
    expect(counts).toEqual({
        auth: 1,
        page: 1,
        delta: 0,
        prepare: chunks.length,
        range: chunks.length
    });

    counts.auth = 0;
    counts.page = 0;
    counts.delta = 0;
    counts.prepare = 0;
    counts.range = 0;
    const deltaFetcher = fetcherFor(chunks, pagesOf(chunks), counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });
    const warm = await syncLibrary(EMAIL, TOKEN, false, cold.unwrap().revision, deltaFetcher);

    expect(warm.unwrap()).toMatchObject({ full: false, items: [], deleted: [] });
    expect(counts).toEqual({ auth: 0, page: 0, delta: 1, prepare: 0, range: 0 });
});

test('a restart with persisted resolved metadata does not probe again', async () => {
    const chunks = items();
    const counts = emptyCounts();
    const coldFetcher = fetcherFor(chunks, pagesOf(chunks), counts, {
        delta: pageBytes([], '', { syncToken: SYNC_ONE })
    });

    const cold = await syncLibrary(EMAIL, TOKEN, false, 0, coldFetcher);
    const revision = cold.unwrap().revision;
    flushLibraryState();
    clearLibraryState();
    clearProbeCache();
    configureLibraryState(join(stateFolder, 'library-state.json'));

    counts.auth = 0;
    counts.page = 0;
    counts.delta = 0;
    counts.prepare = 0;
    counts.range = 0;
    const deltaFetcher = fetcherFor(chunks, pagesOf(chunks), counts, {
        delta: pageBytes([], '', { syncToken: SYNC_TWO })
    });
    const warm = await syncLibrary(EMAIL, TOKEN, false, revision, deltaFetcher);

    expect(warm.unwrap()).toMatchObject({ full: false, items: [], deleted: [] });
    expect(counts).toEqual({ auth: 0, page: 0, delta: 1, prepare: 0, range: 0 });
});
