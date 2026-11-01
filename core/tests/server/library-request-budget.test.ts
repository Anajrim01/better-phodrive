import { createHash } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { readLibrary } from '@madkarmaa/phodrive-core/node/library';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import {
    bytesField,
    message,
    nested,
    numberField,
    utf8
} from '@madkarmaa/phodrive-core/server/protobuf';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

const EMAIL = 'budget@example.com';
const TOKEN = 'aas_et/budget';
const PAGE_URL = '18047484249733410717';
const PREPARE_URL = 'PhotosPrepareDownload';
const DOWNLOAD_HOST = 'https://lh3.googleusercontent.com';
const ITEM_COUNT = 5_000;
const PAGE_SIZE = 200;
const PAGE_COUNT = ITEM_COUNT / PAGE_SIZE;

type Counts = { auth: number; page: number; prepare: number; range: number };

type Item = {
    mediaKey: string;
    sha1: string;
    size: number;
    at: number;
    fileName: string;
    bmp: Buffer;
};

function photoItem(index: number): Item {
    return {
        mediaKey: `photo-${index}`,
        sha1: 'a'.repeat(40),
        size: 1_000,
        at: index,
        fileName: `IMG_${index}.jpg`,
        bmp: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
    };
}

function chunkItem(index: number): Item {
    const payload = Uint8Array.of(index % 251, (index + 1) % 251);
    const fileHash = createHash('sha256').update(`file-${index}`).digest('hex');
    const fileName = `file-${index}.bin`;
    const bmp = Buffer.from(
        encodeSplitBmp(payload, {
            fileHash,
            fileId: fileHash,
            chunkIndex: 0,
            flags: 1,
            payloadSize: payload.length,
            fileName
        }).unwrap()
    );

    return {
        mediaKey: `chunk-${index}`,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at: index,
        fileName: `${fileName}.phodrive-${fileHash}-0-of-1.bmp`,
        bmp
    };
}

function libraryPage(items: readonly Item[], nextToken: string): Buffer {
    const entries = items.map((item) =>
        bytesField(
            2,
            message(
                bytesField(1, item.mediaKey),
                bytesField(
                    2,
                    message(
                        bytesField(4, item.fileName),
                        numberField(9, item.at),
                        numberField(10, item.size),
                        bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex'))))
                    )
                )
            )
        )
    );

    return bytesField(1, message(bytesField(1, Buffer.from(nextToken)), ...entries));
}

function prepareResponse(item: Item): Buffer {
    const url = `${DOWNLOAD_HOST}/p/${item.mediaKey}=d`;
    const image = message(bytesField(5, url));
    const download = message(numberField(1, 1), bytesField(2, image));

    return bytesField(
        1,
        message(
            bytesField(1, item.mediaKey),
            bytesField(
                2,
                message(bytesField(13, message(bytesField(1, Buffer.from(item.sha1, 'hex')))))
            ),
            bytesField(5, download)
        )
    );
}

function pagesOf(items: readonly Item[]): Buffer[] {
    return Array.from({ length: PAGE_COUNT }, (_, index) =>
        libraryPage(
            items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE),
            index + 1 < PAGE_COUNT ? `page-${index + 1}` : ''
        )
    );
}

async function pageIndex(body: BodyInit | null | undefined): Promise<number> {
    const raw = Buffer.from(await new Response(body).arrayBuffer());
    const token = nested(raw, 1, 4).match({
        Ok: (value) => value.toString(),
        Err: () => ''
    });
    if (!token) return 0;

    return Number(token.replace('page-', ''));
}

function fetcherFor(items: readonly Item[], pages: readonly Buffer[], counts: Counts): Fetcher {
    const byKey = new Map(items.map((item) => [item.mediaKey, item]));

    return async (input, init) => {
        const url = String(input);

        if (url === 'https://android.googleapis.com/auth') {
            counts.auth++;

            return new Response(`Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`);
        }

        if (url.includes(PAGE_URL)) {
            counts.page++;
            const index = await pageIndex(init?.body);

            return new Response(new Uint8Array(pages[index]));
        }

        if (url.includes(PREPARE_URL)) {
            counts.prepare++;
            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const mediaKey = nested(request, 1, 1, 1).andThen(utf8).unwrap();
            const item = byKey.get(mediaKey);
            if (!item) throw new Error('Missing probe item');

            return new Response(new Uint8Array(prepareResponse(item)));
        }

        if (url.startsWith(DOWNLOAD_HOST)) {
            counts.range++;
            const mediaKey = url.split('/p/')[1]?.replace('=d', '') ?? '';
            const item = byKey.get(mediaKey);
            if (!item) throw new Error('Missing probe body');

            return new Response(new Uint8Array(item.bmp), { status: 206 });
        }

        throw new Error(`Unexpected request ${url}`);
    };
}

function emptyCounts(): Counts {
    return { auth: 0, page: 0, prepare: 0, range: 0 };
}

beforeEach(() => {
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
});

test('ordinary photos cost one page request and no probes, hot or cold', async () => {
    const items = Array.from({ length: ITEM_COUNT }, (_, index) => photoItem(index));
    const pages = pagesOf(items);
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, pages, counts);

    const library = await readLibrary(EMAIL, TOKEN, fetcher);
    expect(library.unwrap()).toEqual([]);
    expect(counts).toEqual({ auth: 1, page: PAGE_COUNT, prepare: 0, range: 0 });

    counts.auth = 0;
    counts.page = 0;
    const warm = await listBmps(EMAIL, TOKEN, '', fetcher);

    expect(warm.unwrap().items).toEqual([]);
    expect(counts).toEqual({ auth: 0, page: 1, prepare: 0, range: 0 });
}, 60_000);

test('a warm refresh reuses permanent chunk probes', async () => {
    const items = Array.from({ length: ITEM_COUNT }, (_, index) => chunkItem(index));
    const pages = pagesOf(items);
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, pages, counts);

    const library = await readLibrary(EMAIL, TOKEN, fetcher);
    expect(library.unwrap()).toHaveLength(ITEM_COUNT);
    expect(counts).toEqual({
        auth: 1,
        page: PAGE_COUNT,
        prepare: ITEM_COUNT,
        range: ITEM_COUNT
    });

    counts.auth = 0;
    counts.page = 0;
    counts.prepare = 0;
    counts.range = 0;
    const warm = await listBmps(EMAIL, TOKEN, '', fetcher);

    expect(warm.unwrap().items).toHaveLength(PAGE_SIZE);
    expect(counts).toEqual({ auth: 0, page: 1, prepare: 0, range: 0 });
}, 60_000);
