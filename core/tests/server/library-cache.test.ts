import { beforeEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import {
    hasPhodriveNames,
    namedAsNonPhodrive
} from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import {
    bytes,
    bytesField,
    message,
    numberField,
    parse,
    utf8
} from '@madkarmaa/phodrive-core/server/protobuf';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { bmpResponse } from '../helpers/download';

const EMAIL = 'cache@example.com';
const TOKEN = 'aas_et/cache';
const PAGE_URL = '18047484249733410717';
const PREPARE_URL = 'PhotosPrepareDownload';
const DOWNLOAD_HOST = 'https://lh3.googleusercontent.com';

type ProbeCounts = { prepare: number; range: number };

function libraryPage(
    items: { mediaKey: string; sha1: string; size: number; at: number; fileName?: string }[]
): Buffer {
    const entries = items.map((item) => {
        const details = message(
            numberField(9, item.at),
            numberField(10, item.size),
            bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex')))),
            ...(item.fileName ? [bytesField(4, item.fileName)] : [])
        );

        return bytesField(2, message(bytesField(1, item.mediaKey), bytesField(2, details)));
    });

    return bytesField(1, message(...entries));
}

function preparedDownload(mediaKey: string, sha1: string, url: string): Buffer {
    const image = message(bytesField(5, url));
    const download = message(numberField(1, 1), bytesField(2, image));

    return bytesField(
        1,
        message(
            bytesField(1, mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

function videoDownload(mediaKey: string, sha1: string): Buffer {
    const download = message(numberField(1, 2), bytesField(3, message()));

    return bytesField(
        1,
        message(
            bytesField(1, mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

function fixture(name: string, payload: string) {
    const bytes = Buffer.from(payload);
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    const bmp = encodeSplitBmp(bytes, {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        flags: 1,
        payloadSize: bytes.length,
        fileName: name
    }).unwrap();

    return {
        mediaKey: `media-${fileHash.slice(0, 8)}`,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at: 1,
        bmp
    };
}

function fetcherFor(
    page: Buffer,
    prepared: { mediaKey: string; sha1: string; url: string },
    body: Response | (() => Response),
    counts: ProbeCounts
): Fetcher {
    return async (input) => {
        const url = String(input);
        if (url === 'https://android.googleapis.com/auth')
            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);

        if (url.includes(PAGE_URL)) return new Response(new Uint8Array(page));

        if (url.includes(PREPARE_URL)) {
            counts.prepare++;
            return new Response(
                new Uint8Array(preparedDownload(prepared.mediaKey, prepared.sha1, prepared.url))
            );
        }

        if (url.startsWith(DOWNLOAD_HOST)) {
            counts.range++;
            return typeof body === 'function' ? body() : body;
        }

        throw new Error(`Unexpected request ${url}`);
    };
}

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

test('a page with a Phodrive name skips the ordinary item', async () => {
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
});

test('a page without a Phodrive name probes every item', async () => {
    const file = fixture('ordinary.bmp', 'ordinary content');
    const counts: ProbeCounts = { prepare: 0, range: 0 };
    const fetcher = fetcherFor(
        libraryPage([{ ...file, fileName: 'IMG_0001.jpg' }]),
        { mediaKey: file.mediaKey, sha1: file.sha1, url: `${DOWNLOAD_HOST}/photo` },
        () => new Response(file.bmp),
        counts
    );

    const items = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap().items;

    expect(items).toHaveLength(1);
    expect(items[0]?.mediaKey).toBe(file.mediaKey);
    expect(counts).toEqual({ prepare: 1, range: 1 });
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

test('the real library capture keeps the name filter page scoped', async () => {
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

    expect(items).toHaveLength(6);
    expect(markers).toHaveLength(5);
    expect(ordinary).toBeDefined();
    expect(hasPhodriveNames(names.map((fileName) => ({ fileName })))).toBe(true);
    expect(namedAsNonPhodrive({ fileName: ordinary }, true)).toBe(true);
    expect(namedAsNonPhodrive({ fileName: markers[0] }, true)).toBe(false);
    expect(hasPhodriveNames([{ fileName: ordinary }])).toBe(false);
    expect(namedAsNonPhodrive({ fileName: ordinary }, false)).toBe(false);
});
