import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    DOWNLOAD_HOST,
    PAGE_URL,
    PREPARE_URL,
    fetcherFor,
    fixture,
    libraryPage,
    preparedDownload,
    type ProbeCounts
} from '../helpers/library';

const EMAIL = 'policy@example.com';
const TOKEN = 'aas_et/policy';

beforeEach(() => clearProbeCache());
afterEach(() => {
    vi.restoreAllMocks();
    clearThrottleState();
});

test('a cached chunk renamed without the marker is skipped', async () => {
    const file = fixture('note.txt', 'renamed probe content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const prepared = { mediaKey: file.mediaKey, sha1: file.sha1, url: `${DOWNLOAD_HOST}/photo` };
    const marker = `note.txt.phodrive-${file.sha1}-0-of-1.bmp`;

    await listBmps(
        EMAIL,
        TOKEN,
        '',
        fetcherFor(
            libraryPage([{ ...file, fileName: marker }]),
            prepared,
            () => new Response(file.bmp),
            counts
        )
    );
    expect(counts).toEqual({ prepare: 1, range: 1 });

    const renamed = await listBmps(
        EMAIL,
        TOKEN,
        '',
        fetcherFor(
            libraryPage([{ ...file, fileName: 'renamed.jpg' }]),
            prepared,
            () => new Response(file.bmp),
            counts
        )
    );

    expect(renamed.unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 1, range: 1 });
});

test('a probe media 429 names the media fetch stage and host once', async () => {
    const file = fixture('note.txt', 'probe throttle content');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = libraryPage([{ ...file, fileName: `note.txt.phodrive-${file.sha1}-0-of-1.bmp` }]);
    const prepared = {
        mediaKey: file.mediaKey,
        sha1: file.sha1,
        url: `${DOWNLOAD_HOST}/photo`
    };
    const fetcher: Fetcher = async (input) => {
        const url = String(input);

        if (url === 'https://android.googleapis.com/auth')
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes(PAGE_URL)) return new Response(new Uint8Array(page));
        if (url.includes(PREPARE_URL))
            return new Response(
                new Uint8Array(preparedDownload(prepared.mediaKey, prepared.sha1, prepared.url))
            );
        if (url.startsWith(DOWNLOAD_HOST))
            return new Response(null, { status: 429, headers: { 'retry-after': '9' } });

        throw new Error(`Unexpected request ${url}`);
    };

    const result = await listBmps(EMAIL, TOKEN, '', fetcher);

    expect(result.unwrapErr().code).toBe('THROTTLED');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
        'Google Photos rate limited Media fetch on lh3.googleusercontent.com'
    );
    expect(String(warn.mock.calls[0][0])).not.toContain('photo');
});
