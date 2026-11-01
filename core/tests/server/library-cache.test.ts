import { beforeEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { readProbe } from '@madkarmaa/phodrive-core/server/photos/library/probe-cache';
import { namedAsNonPhodrive } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { bytes, parse, utf8 } from '@madkarmaa/phodrive-core/server/protobuf';
import { bmpResponse } from '../helpers/download';
import {
    DOWNLOAD_HOST,
    PAGE_URL,
    PREPARE_URL,
    fetcherFor,
    fixture,
    libraryPage,
    preparedDownload,
    videoDownload,
    type ProbeCounts
} from '../helpers/library';

const EMAIL = 'cache@example.com';
const TOKEN = 'aas_et/cache';

beforeEach(() => clearProbeCache());

test('a second library page load reuses probed headers and skips Google requests', async () => {
    const file = fixture('note.txt', 'probe cache content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const url = `${DOWNLOAD_HOST}/photo`;
    const fetcher = fetcherFor(
        libraryPage([file]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url },
        bmpResponse(file.bmp),
        counts
    );

    const first = await listBmps(EMAIL, TOKEN, '', fetcher);
    expect(first.unwrap().items).toHaveLength(1);
    expect(first.unwrap().items[0]?.originalName).toBe('note.txt');
    expect(counts).toEqual({ prepare: 1, range: 1 });

    const second = await listBmps(EMAIL, TOKEN, '', fetcher);
    expect(second.unwrap().items).toEqual(first.unwrap().items);
    expect(counts).toEqual({ prepare: 1, range: 1 });
});

test('a changed fingerprint probes the item again', async () => {
    const first = fixture('note.txt', 'first content');
    const second = fixture('note.txt', 'changed content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const url = `${DOWNLOAD_HOST}/photo`;

    await listBmps(
        EMAIL,
        TOKEN,
        '',
        fetcherFor(
            libraryPage([first]),
            { mediaKey: first.mediaKey, sha1: first.sha1, url },
            bmpResponse(first.bmp),
            counts
        )
    );

    const changed = await listBmps(
        EMAIL,
        TOKEN,
        '',
        fetcherFor(
            libraryPage([second]),
            { mediaKey: second.mediaKey, sha1: second.sha1, url },
            bmpResponse(second.bmp),
            counts
        )
    );

    expect(changed.unwrap().items[0]?.sha1).toBe(second.sha1);
    expect(counts).toEqual({ prepare: 2, range: 2 });
});

test('items that are not Phodrive files are cached as misses', async () => {
    const photo = {
        mediaKey: 'ordinary-photo',
        sha1: 'a'.repeat(40),
        size: 1_000,
        at: 1
    };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const url = `${DOWNLOAD_HOST}/photo`;
    const fetcher = fetcherFor(
        libraryPage([photo]),
        { mediaKey: photo.mediaKey, sha1: photo.sha1, url },
        new Response('not a split bmp'),
        counts
    );

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 1, range: 1 });

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 1, range: 1 });
});

test('a truncated Phodrive header is not cached as a miss', async () => {
    const file = fixture('note.txt', 'partial header content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const url = `${DOWNLOAD_HOST}/photo`;
    const fetcher = fetcherFor(
        libraryPage([file]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url },
        () => new Response(file.bmp.subarray(0, 30)),
        counts
    );

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 1, range: 1 });

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 2, range: 2 });
});

test('a video without a download URL is not cached as a miss', async () => {
    const file = fixture('clip.mp4', 'video bytes');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher: Fetcher = async (input) => {
        const url = String(input);

        if (url === 'https://android.googleapis.com/auth')
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        if (url.includes(PAGE_URL)) return new Response(new Uint8Array(libraryPage([file])));
        if (url.includes(PREPARE_URL)) {
            counts.prepare++;

            return new Response(new Uint8Array(videoDownload(file.mediaKey, file.sha1)));
        }

        throw new Error(`Unexpected request ${url}`);
    };

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 1, range: 0 });

    expect((await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items).toEqual([]);
    expect(counts).toEqual({ prepare: 2, range: 0 });
});

test('a named ordinary item beside a chunk is skipped', async () => {
    const file = fixture('note.txt', 'named probe content');
    const ordinary = {
        mediaKey: 'ordinary-photo',
        sha1: 'a'.repeat(40),
        size: 1_000,
        at: 1,
        fileName: 'IMG_0001.jpg'
    };
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([ordinary, { ...file, fileName: `note.txt.phodrive-${file.sha1}-0-of-1.bmp` }]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;

    expect(items).toHaveLength(1);
    expect(items[0]?.originalName).toBe('note.txt');
    expect(counts).toEqual({ prepare: 1, range: 1 });
    expect(readProbe(EMAIL, ordinary)).toBeUndefined();
});

test('a named item without the marker is skipped without a request', async () => {
    const file = fixture('ordinary.bmp', 'ordinary content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([{ ...file, fileName: 'IMG_0001.jpg' }]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;

    expect(items).toEqual([]);
    expect(counts).toEqual({ prepare: 0, range: 0 });
    expect(readProbe(EMAIL, file)).toBeUndefined();
});

test('a name with the Phodrive marker still probes', async () => {
    const file = fixture('note.txt', 'named probe content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([{ ...file, fileName: 'note.txt.phodrive-' + file.sha1 + '-0-of-1.bmp' }]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;

    expect(items).toHaveLength(1);
    expect(counts).toEqual({ prepare: 1, range: 1 });
});

test('the real library capture filters every named item without the marker', async () => {
    const body = await readFile(new URL('../fixtures/library-page.bin', import.meta.url));
    const root = (await parse(body)).unwrap();
    const page = (await parse((await bytes(root, 1)).unwrap())).unwrap();
    const items = page.filter((field) => field.number === 2 && typeof field.value !== 'number');
    const names: string[] = [];

    for (const item of items) {
        const entry = (await parse(item.value as Buffer)).unwrap();
        const details = (await parse((await bytes(entry, 2)).unwrap())).unwrap();
        const nameField = details.find(
            (field) => field.number === 4 && typeof field.value !== 'number'
        );
        if (!nameField || typeof nameField.value === 'number') throw new Error('Missing name');

        names.push((await utf8(nameField.value)).unwrap());
    }

    const markers = names.filter((name) => name.includes('.phodrive-'));
    const ordinary = names.find((name) => !name.includes('.phodrive-'));

    expect(items).toHaveLength(5);
    expect(markers).toHaveLength(4);
    expect(ordinary).toBeDefined();
    expect(namedAsNonPhodrive({ fileName: ordinary })).toBe(true);
    expect(namedAsNonPhodrive({ fileName: markers[0] })).toBe(false);
    expect(namedAsNonPhodrive({})).toBe(false);
});
