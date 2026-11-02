import { expect, test } from 'vitest';
import { createShare } from '@madkarmaa/phodrive-core/server/share';
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

test('a returned link that never serves rotates once and keeps the live URL', async () => {
    const firstUrl = 'https://photos.app.goo.gl/first01';
    const secondUrl = 'https://photos.app.goo.gl/second2';
    let updateCalls = 0;

    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, firstUrl));
        if (url === UPDATE_LINK) {
            updateCalls++;

            return bodyResponse(linkResponse(updateCalls === 1 ? firstUrl : secondUrl));
        }
        if (url === firstUrl) return new Response(null, { status: 404 });
        if (url === secondUrl) {
            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) return htmlPage();

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 2, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0
    });

    expect(created.unwrap().record.shortUrl).toBe(secondUrl);
    expect(updateCalls).toBe(2);
});
test('an ambiguous first enable is not retried and cleans up the dedicated album', async () => {
    const calls: string[] = [];
    let state = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, SHORT_URL));
        if (url === UPDATE_LINK) {
            state = requestState(protobuf(init?.body));

            return state === 2 ? new Response(null, { status: 503 }) : new Response(null);
        }
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM) return new Response(null);

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 1, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0
    });

    expect(created.unwrapErr().code).toBe('SHARE_LINK_UNCERTAIN');
    expect(calls.filter((url) => url === UPDATE_LINK)).toHaveLength(2);
    expect(state).toBe(1);
    expect(calls).toContain(DELETE_ENVELOPE);
    expect(calls).toContain(REMOVE_ALBUM);
    expect(calls.filter((url) => url === CREATE_ALBUM)).toHaveLength(1);
});

test('a share that never serves is disabled, deleted, and its album removed', async () => {
    const calls: string[] = [];
    let state = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, SHORT_URL));
        if (url === UPDATE_LINK) {
            state = requestState(protobuf(init?.body));

            return state === 2 ? bodyResponse(linkResponse(SHORT_URL)) : new Response(null);
        }
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM) return new Response(null);

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 2, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0
    });

    expect(created.unwrapErr().code).toBe('SHARE_LINK_NOT_LIVE');
    expect(state).toBe(1);
    expect(calls).toContain(DELETE_ENVELOPE);
    expect(calls).toContain(REMOVE_ALBUM);
});

test('malformed envelope responses remove the new album without deleting an envelope', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return new Response(Uint8Array.from([10, 5, 1]));
        if (url === REMOVE_ALBUM) return new Response(null);

        return new Response(null, { status: 500 });
    };

    const created = await createShare(request(), fetcher);

    expect(created.isErr()).toBe(true);
    expect(calls).toContain(REMOVE_ALBUM);
    expect(calls).not.toContain(DELETE_ENVELOPE);
});

test('malformed link responses clean up the envelope and album', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, SHORT_URL));
        if (url === UPDATE_LINK) return new Response(Uint8Array.from([10, 1]));
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM) return new Response(null);

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 1, delayMs: 0, sleep: async () => undefined }
    });

    expect(created.isErr()).toBe(true);
    expect(calls).toContain(DELETE_ENVELOPE);
    expect(calls).toContain(REMOVE_ALBUM);
});

test('an ambiguous enable falls back to polling the pending album URL', async () => {
    const pending = 'https://photos.app.goo.gl/pending1';
    const calls: string[] = [];
    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, pending));
        if (url === UPDATE_LINK) return new Response(null, { status: 503 });
        if (url === pending) {
            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) return htmlPage();

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 2, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0
    });

    expect(created.unwrap().record.shortUrl).toBe(pending);
    expect(created.unwrap().record.authKey).toBe('');
    expect(calls).not.toContain(DELETE_ENVELOPE);
    expect(calls).not.toContain(REMOVE_ALBUM);
});

test('failed cleanup returns recovery keys instead of a silent orphan', async () => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === CREATE_ALBUM) return bodyResponse(albumResponse(ALBUM_KEY));
        if (url === CREATE_ENVELOPE) return bodyResponse(envelopeResponse(ENVELOPE_KEY, SHORT_URL));
        if (url === UPDATE_LINK) {
            return requestState(protobuf(init?.body)) === 2
                ? new Response(null, { status: 503 })
                : new Response(null, { status: 500 });
        }
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null, { status: 500 });

        return new Response(null, { status: 404 });
    };

    const created = await createShare(request(), fetcher, {
        poll: { attempts: 1, delayMs: 0, sleep: async () => undefined },
        retryDelayMs: 0
    });
    const error = created.unwrapErr();

    expect(error.code).toBe('SHARE_LINK_UNCERTAIN');
    expect('recovery' in error ? error.recovery : null).toEqual({
        envelopeKey: ENVELOPE_KEY,
        albumKey: ALBUM_KEY
    });
});
