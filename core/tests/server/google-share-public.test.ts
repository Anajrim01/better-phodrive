import { expect, test } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    extractListingRequest,
    pageRequest,
    parseAlbumUrl,
    parseBatchExecute,
    parseListingPage,
    slotPaths
} from '@madkarmaa/phodrive-core/server/photos/shares/google-listing';
import {
    classifyPublicProbe,
    resolveShortUrl
} from '@madkarmaa/phodrive-core/server/photos/shares/google-public';
import { readPublicListing } from '@madkarmaa/phodrive-core/server/photos/shares/google-public-listing';
import {
    isExactRange,
    readRange,
    type RangeRead
} from '@madkarmaa/phodrive-core/server/photos/shares/google-range';

const UID = 'AF1QipAlbum';
const KEY = 'capabilityKey';
const ALBUM = {
    uid: UID,
    key: KEY,
    canonicalUrl: `https://photos.google.com/share/${UID}?key=${KEY}`
};
const PAGE_HTML = `<script>AF_dataServiceRequests = {'ds:1' : {id:'rpcOne',request:["${UID}",null,null,"${KEY}"]}};</script>`;

function item(id: string, dedupKey: unknown = `dedup-${id}`): unknown[] {
    return [id, [`https://lh3.googleusercontent.com/pw/${id}`, 32, 32], 1, dedupKey];
}

function page(items: unknown[], count: number, token: unknown = null): unknown[] {
    const metadata = new Array(22).fill(null);
    metadata[21] = count;

    return [null, items, token, metadata];
}

function batchBody(data: unknown): string {
    const frame = JSON.stringify([['wrb.fr', 'rpcOne', JSON.stringify(data), null]]);

    return `)]}'\n\n${frame.length}\n${frame}\n25\n[["di",1]]\n`;
}

function listingFetcher(pages: unknown[]): {
    fetcher: Fetcher;
    requests: unknown[][];
    headers: Headers[];
} {
    const requests: unknown[][] = [];
    const headers: Headers[] = [];
    const fetcher: Fetcher = async (input, init) => {
        headers.push(new Headers(init?.headers));
        if (init?.method === 'GET') return new Response(PAGE_HTML, { status: 200 });

        const frame = new URLSearchParams(String(init?.body)).get('f.req') ?? '';
        requests.push(JSON.parse(JSON.parse(frame)[0][0][1]));

        return new Response(batchBody(pages[requests.length - 1]));
    };

    return { fetcher, requests, headers };
}

test('album links keep only https photos.google.com capability URLs without a length cap', () => {
    const long = 'a'.repeat(5_000);

    expect(parseAlbumUrl(`https://photos.google.com/share/${long}?key=${long}`).isOk()).toBe(true);
    expect(parseAlbumUrl(`https://photos.google.com/share/${UID}?key=${KEY}&x=1`).unwrap()).toEqual(
        ALBUM
    );

    for (const url of [
        `http://photos.google.com/share/${UID}?key=${KEY}`,
        `https://evil.example/share/${UID}?key=${KEY}`,
        `https://photos.google.com:8443/share/${UID}?key=${KEY}`,
        `https://user:pass@photos.google.com/share/${UID}?key=${KEY}`,
        `https://photos.google.com/share/${UID}?key=${KEY}#fragment`,
        `https://photos.google.com/share/${UID}?key=${KEY}&key=second`,
        `https://photos.google.com/share/${UID}`,
        `https://photos.google.com/other/${UID}?key=${KEY}`,
        'not a url'
    ])
        expect(parseAlbumUrl(url).isErr()).toBe(true);
});

test('the listing request comes from one exact page entry with an empty token slot', () => {
    const listing = extractListingRequest(PAGE_HTML, ALBUM).unwrap();

    expect(listing).toEqual({ rpcId: 'rpcOne', request: [UID, null, null, KEY] });
    expect(pageRequest(listing, 'token')).toEqual([UID, 'token', null, KEY]);
});

test('an unrecognised listing page or token slot fails instead of guessing', () => {
    expect(extractListingRequest('<html></html>', ALBUM).unwrapErr().code).toBe(
        'GOOGLE_LISTING_SHAPE_CHANGED'
    );
    expect(
        extractListingRequest(
            `${PAGE_HTML}${PAGE_HTML.replace('rpcOne', 'rpcTwo')}`,
            ALBUM
        ).unwrapErr().code
    ).toBe('GOOGLE_LISTING_SHAPE_CHANGED');
    expect(
        extractListingRequest(
            `{id:'rpcOne',request:["${UID}","${KEY}",null,"${KEY}"]}`,
            ALBUM
        ).unwrapErr().code
    ).toBe('GOOGLE_LISTING_PAGINATION_UNKNOWN');
});

test('batchexecute frames decode the named RPC and reject anything else', () => {
    expect(parseBatchExecute(batchBody({ ok: true }), 'rpcOne').unwrap()).toEqual({ ok: true });
    expect(parseBatchExecute(batchBody({ ok: true }), 'other').isErr()).toBe(true);
    expect(parseBatchExecute('[["wrb.fr","rpcOne",null]]', 'rpcOne').isErr()).toBe(true);
    expect(parseBatchExecute('[["wrb.fr","rpcOne","not json"]]', 'rpcOne').isErr()).toBe(true);
    expect(parseBatchExecute('', 'rpcOne').isErr()).toBe(true);
});

test('a listing page exposes hypothesised slots and normalises the download URL', () => {
    const parsed = parseListingPage(page([item('itemOne')], 1)).unwrap();

    expect(parsed.count).toBe(1);
    expect(parsed.nextPageToken).toBeNull();
    expect(parsed.items[0]).toMatchObject({
        id: 'itemOne',
        downloadUrl: 'https://lh3.googleusercontent.com/pw/itemOne=d',
        dedupKey: 'dedup-itemOne'
    });
    expect(parseListingPage(page([item('itemOne', 7)], 1)).unwrap().items[0].dedupKey).toBeNull();
    expect(parseListingPage(page([], 0, 'next')).unwrap().nextPageToken).toBe('next');
});

test.each([
    ['numeric', 7],
    ['empty', ''],
    ['array', ['next']]
])('a %s next-page slot is an unknown pagination format', (_name, token) => {
    expect(parseListingPage(page([], 0, token)).unwrapErr().code).toBe(
        'GOOGLE_LISTING_PAGINATION_UNKNOWN'
    );
});

test.each([
    ['not an array', 'data'],
    ['no metadata', [null, []]],
    ['no count', [null, [], null, []]],
    ['bad item', page([['id']], 1)],
    ['other host', page([['itemOne', ['https://evil.example/pw/itemOne']]], 1)],
    ['query string', page([['itemOne', ['https://lh3.googleusercontent.com/pw/x?y=1']]], 1)]
])('a listing page with %s is a changed shape', (_name, data) => {
    expect(parseListingPage(data).unwrapErr().code).toBe('GOOGLE_LISTING_SHAPE_CHANGED');
});

test('slot paths locate a value anywhere in an entry', () => {
    expect(slotPaths(item('itemOne', 'needle'), 'needle')).toEqual(['3']);
    expect(slotPaths(['a', ['b', 'needle']], 'needle')).toEqual(['1.1']);
    expect(slotPaths(['a'], 'needle')).toEqual([]);
});

test('listing follows next tokens through request slot 1 without owner credentials', async () => {
    const { fetcher, requests, headers } = listingFetcher([
        page([item('itemOne')], 2, 'page-two'),
        page([item('itemTwo')], 2)
    ]);
    const listing = (await readPublicListing(ALBUM, fetcher)).unwrap();

    expect(listing.pages).toBe(2);
    expect(listing.items.map(({ id }) => id)).toEqual(['itemOne', 'itemTwo']);
    expect(requests).toEqual([
        [UID, null, null, KEY],
        [UID, 'page-two', null, KEY]
    ]);

    for (const sent of headers) {
        expect(sent.has('authorization')).toBe(false);
        expect(sent.has('cookie')).toBe(false);
    }
});

test.each([
    [
        'a page count short of the stated total',
        [page([item('itemOne')], 2)],
        'GOOGLE_LISTING_INCOMPLETE'
    ],
    [
        'a repeated next token',
        [page([item('itemOne')], 9, 'same'), page([item('itemTwo')], 9, 'same')],
        'GOOGLE_LISTING_PAGINATION_UNKNOWN'
    ],
    ['an empty continuing page', [page([], 9, 'next')], 'GOOGLE_LISTING_PAGINATION_UNKNOWN'],
    [
        'the same item twice',
        [page([item('itemOne')], 2, 'next'), page([item('itemOne')], 2)],
        'GOOGLE_LISTING_SHAPE_CHANGED'
    ]
])('listing fails on %s', async (_name, pages, code) => {
    const result = await readPublicListing(ALBUM, listingFetcher(pages).fetcher);

    expect(result.unwrapErr().code).toBe(code);
});

test('short links resolve only to a canonical album URL', async () => {
    const redirect =
        (location: string): Fetcher =>
        async () =>
            new Response(null, { status: 302, headers: { location } });

    const resolved = await resolveShortUrl('https://short.test/a', redirect(ALBUM.canonicalUrl));
    expect(resolved.unwrap()).toMatchObject({
        canonicalUrl: ALBUM.canonicalUrl,
        locationHost: 'photos.google.com',
        toShare: true
    });

    const elsewhere = await resolveShortUrl('https://short.test/a', redirect('https://x.test/'));
    expect(elsewhere.unwrap()).toMatchObject({ canonicalUrl: null, toShare: false });
});

test.each([
    [200, null, false, 'live'],
    [206, null, false, 'live'],
    [401, null, false, 'stopped'],
    [404, null, false, 'stopped'],
    [410, null, false, 'stopped'],
    [302, 'accounts.google.com', false, 'unknown'],
    [302, 'lh3.googleusercontent.com', false, 'unknown'],
    [302, 'unverified.invalid', false, 'unknown'],
    [302, 'photos.google.com', true, 'unknown'],
    [302, null, false, 'unknown'],
    [500, null, false, 'unknown']
])('status %i to %s is classified %s', (status, locationHost, toShare, state) => {
    expect(classifyPublicProbe({ status, locationHost, toShare })).toBe(state);
});

test('a closed range is exact only with matching status, headers and body length', () => {
    const read: RangeRead = {
        status: 206,
        locationHost: null,
        toShare: false,
        contentRange: 'bytes 0-3/4',
        contentLength: '4',
        allowOrigin: null,
        exposeHeaders: null,
        body: Buffer.alloc(4)
    };

    expect(isExactRange(read, 0, 3, 4)).toBe(true);
    expect(isExactRange({ ...read, status: 200 }, 0, 3, 4)).toBe(false);
    expect(isExactRange({ ...read, contentRange: 'bytes 0-3/*' }, 0, 3, 4)).toBe(false);
    expect(isExactRange({ ...read, contentLength: '5' }, 0, 3, 4)).toBe(false);
    expect(isExactRange({ ...read, body: Buffer.alloc(3) }, 0, 3, 4)).toBe(false);
});

test('range reads send identity encoding, surface CORS headers and skip stopped bodies', async () => {
    let sent = new Headers();
    const fetcher: Fetcher = async (_input, init) => {
        sent = new Headers(init?.headers);

        return new Response(Buffer.alloc(2), {
            status: 206,
            headers: { 'access-control-allow-origin': '*', 'content-range': 'bytes 1-2/4' }
        });
    };
    const read = (
        await readRange('https://media.test/a=d', 1, 2, 'https://o.test', fetcher)
    ).unwrap();

    expect(sent.get('range')).toBe('bytes=1-2');
    expect(sent.get('accept-encoding')).toBe('identity');
    expect(sent.get('origin')).toBe('https://o.test');
    expect(sent.has('authorization')).toBe(false);
    expect(read).toMatchObject({ allowOrigin: '*', contentRange: 'bytes 1-2/4' });
    expect(read.body.length).toBe(2);

    const stopped: Fetcher = async () => new Response('gone', { status: 404 });
    const missing = await readRange('https://media.test/a=d', 1, 2, 'https://o.test', stopped);

    expect(missing.unwrap().body.length).toBe(0);
});
