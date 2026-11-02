import { expect, test } from 'vitest';
import { createShare, decodeShareUrl } from '@madkarmaa/phodrive-core/server/share';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { bytes, parse } from '@madkarmaa/phodrive-core/server/protobuf';
import {
    ALBUM_KEY,
    albumResponse,
    AUTH_RESPONSE,
    bodyResponse,
    CANONICAL,
    CREATE_ALBUM,
    CREATE_ENVELOPE,
    DELETE_ENVELOPE,
    ENVELOPE_KEY,
    EXISTING_SHARE,
    envelopeResponse,
    htmlPage,
    linkResponse,
    protobuf,
    REMOVE_ALBUM,
    request,
    requestState,
    SECOND_FILE_ID,
    SHORT_URL,
    UPDATE_LINK,
    FILE_ID
} from '../helpers/share';

test('create makes a dedicated album, enables the link, and builds the manifest', async () => {
    const calls: string[] = [];
    const bodies = new Map<string, Buffer>();
    let probes = 0;

    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) {
            bodies.set('album', protobuf(init?.body));
            return bodyResponse(albumResponse(ALBUM_KEY));
        }
        if (url === CREATE_ENVELOPE) {
            bodies.set('envelope', protobuf(init?.body));
            return bodyResponse(envelopeResponse(ENVELOPE_KEY, SHORT_URL));
        }
        if (url === UPDATE_LINK) {
            bodies.set('link', protobuf(init?.body));
            return bodyResponse(linkResponse(SHORT_URL));
        }
        if (url === SHORT_URL) {
            probes++;

            return probes < 3
                ? new Response(null, { status: 404 })
                : new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) return htmlPage();

        return new Response(null, { status: 500 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 4, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0,
        now: () => 1_700_000_000_000
    });
    const response = created.unwrap();

    expect(response.record).toMatchObject({
        envelopeKey: ENVELOPE_KEY,
        albumKey: ALBUM_KEY,
        shortUrl: SHORT_URL,
        albumUrl: CANONICAL,
        createdAt: 1_700_000_000_000
    });
    expect(response.manifest.files).toEqual([
        { id: FILE_ID, chunks: 2, name: 'photo.jpg' },
        { id: SECOND_FILE_ID, chunks: 1, name: 'notes.txt' }
    ]);
    expect(response.record.shareUrl.startsWith('https://shared.phodrive.dev/#share=')).toBe(true);

    const albumBody = bodies.get('album');
    expect(albumBody).toBeDefined();
    for (const key of ['media-0', 'media-1', 'media-2'])
        expect(albumBody!.includes(Buffer.from(key))).toBe(true);

    const envelope = parse(bodies.get('envelope')!).unwrap();
    const permissions = parse(bytes(envelope, 3).unwrap()).unwrap();
    expect(permissions.filter((field) => field.number === 7)).toHaveLength(5);
    expect(calls.filter((url) => url === CREATE_ALBUM)).toHaveLength(1);
    expect(calls.filter((url) => url === CREATE_ENVELOPE)).toHaveLength(1);
    expect(probes).toBe(3);
});

test('an existing envelope and live link are reused without creating anything', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url === SHORT_URL) {
            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) return htmlPage();

        return new Response(null, { status: 500 });
    };

    const created = await createShare(
        request({
            existing: EXISTING_SHARE,
            files: undefined
        }),
        fetcher,
        { poll: { attempts: 2, delayMs: 0, sleep: async () => undefined } }
    );

    expect(created.unwrap().record.envelopeKey).toBe(ENVELOPE_KEY);
    expect(created.unwrap().record.createdAt).toBe(EXISTING_SHARE.createdAt);
    expect(calls).toEqual([SHORT_URL, CANONICAL]);
});

test('an existing envelope with a dead link is enabled again without creating anything', async () => {
    const liveUrl = 'https://photos.app.goo.gl/live123';
    const calls: string[] = [];
    let state = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK) {
            state = requestState(protobuf(init?.body));

            return bodyResponse(linkResponse(liveUrl));
        }
        if (url === SHORT_URL) return new Response(null, { status: 404 });
        if (url === liveUrl) {
            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) return htmlPage();

        return new Response(null, { status: 500 });
    };

    const created = await createShare(
        request({
            existing: EXISTING_SHARE,
            files: undefined
        }),
        fetcher,
        { poll: { attempts: 1, delayMs: 0, sleep: async () => undefined }, retryDelayMs: 0 }
    );

    expect(state).toBe(2);
    expect(created.unwrap().record.shortUrl).toBe(liveUrl);
    expect(calls).not.toContain(CREATE_ALBUM);
    expect(calls).not.toContain(CREATE_ENVELOPE);
});

test('an existing share cannot be reused with a new file selection', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 500 });
    };

    const created = await createShare(request({ existing: EXISTING_SHARE }), fetcher);

    expect(created.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(calls).toBe(0);
});

test('re-enabling a rotated link rebuilds the viewer URL and manifest', async () => {
    const rotated = 'https://photos.google.com/share/Rotated?key=OtherKey';
    const liveUrl = 'https://photos.app.goo.gl/rotated';
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK) return bodyResponse(linkResponse(liveUrl));
        if (url === SHORT_URL) return new Response(null, { status: 404 });
        if (url === liveUrl) {
            return new Response(null, { status: 302, headers: { location: rotated } });
        }
        if (url === rotated) return htmlPage();

        return new Response(null, { status: 404 });
    };

    const created = await createShare(
        request({ existing: EXISTING_SHARE, files: undefined }),
        fetcher,
        { poll: { attempts: 2, delayMs: 0, sleep: async () => undefined } }
    );
    const response = created.unwrap();

    expect(response.record.albumUrl).toBe(rotated);
    expect(decodeShareUrl(response.record.shareUrl).unwrap().album).toBe(rotated);
    expect(response.manifest.album).toBe(rotated);
});
