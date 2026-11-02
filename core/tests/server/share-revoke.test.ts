import { expect, test } from 'vitest';
import { revokeShare } from '@madkarmaa/phodrive-core/server/share';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    AUTH_RESPONSE,
    CANONICAL,
    DELETE_ENVELOPE,
    htmlPage,
    protobuf,
    REMOVE_ALBUM,
    requestState,
    revokeRequest,
    SHORT_URL,
    UPDATE_LINK
} from '../helpers/share';

test('revoke disables the link, deletes the envelope and album, and verifies every URL', async () => {
    const calls: string[] = [];
    let live = true;
    const direct = 'https://lh3.googleusercontent.com/p/abc=d';
    let state = 0;

    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === SHORT_URL) {
            if (init?.redirect === 'follow' && live) return htmlPage();

            return live
                ? new Response(null, { status: 302, headers: { location: CANONICAL } })
                : new Response(null, { status: 404 });
        }
        if (url === CANONICAL) {
            return live ? htmlPage() : new Response(null, { status: 404 });
        }
        if (url === direct) {
            return live
                ? new Response(Uint8Array.from([1, 2, 3]))
                : new Response(null, {
                      status: 302,
                      headers: { location: 'https://accounts.google.com' }
                  });
        }
        if (url === UPDATE_LINK) {
            state = requestState(protobuf(init?.body));
            if (state === 1) live = false;

            return new Response(null);
        }
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM) return new Response(null);

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 2
    });
    const response = revoked.unwrap();

    expect(state).toBe(1);
    expect(response).toMatchObject({
        revoked: true,
        shortUrlStatus: 404,
        albumUrlStatus: 404,
        directUrlStatus: 302,
        envelopeDeleted: true,
        albumRemoved: true
    });
    expect(calls).toContain(DELETE_ENVELOPE);
    expect(calls).toContain(REMOVE_ALBUM);
    expect(live).toBe(false);
});

test('revoke fails when the old link still serves after cleanup', async () => {
    const direct = 'https://lh3.googleusercontent.com/p/abc=d';
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK || url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null);
        if (url === SHORT_URL) {
            if (init?.redirect === 'follow') return htmlPage();

            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL || url === direct) return htmlPage();

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_LINK_STILL_LIVE');
});

test('revoke fails closed when the public URLs cannot be checked', async () => {
    const fetcher: Fetcher = async () => {
        throw new Error('network down');
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_REVOKE_UNVERIFIED');
});

test('server errors during verification do not count as stopped', async () => {
    const fetcher: Fetcher = async (input) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK || url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null);
        if (url === SHORT_URL || url === CANONICAL) return new Response(null, { status: 500 });

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_REVOKE_UNVERIFIED');
});

test('a failed canonical page probe leaves revoke unverified', async () => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK || url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null);
        if (url === SHORT_URL) {
            if (init?.redirect === 'follow') return htmlPage();

            return new Response(null, { status: 302, headers: { location: CANONICAL } });
        }
        if (url === CANONICAL) throw new Error('canonical probe failed');

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_REVOKE_UNVERIFIED');
});

test('a failed disable is unverified even when the stored URLs are dead', async () => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK) return new Response(null, { status: 500 });
        if (url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null, { status: 404 });
        if (url === SHORT_URL) return new Response(null, { status: 404 });
        if (url === CANONICAL) return new Response(null, { status: 404 });

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });
    const error = revoked.unwrapErr();

    expect(error.code).toBe('SHARE_REVOKE_UNVERIFIED');
    expect('recovery' in error ? error.recovery : null).toEqual({
        envelopeKey: 'AF1QipEnvelope',
        albumKey: 'AF1QipAlbum'
    });
});

test.each([
    ['full share path', 'https://photos.google.com/share/Live?key=Other&hl=en'],
    ['bare share path', 'https://photos.google.com/share'],
    ['user share path', 'https://photos.google.com/u/0/share/Live']
])('a %s redirect on the short URL is not stopped evidence', async (_label, liveRedirect) => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK || url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null);
        if (url === SHORT_URL) {
            if (init?.redirect === 'follow') return new Response(null, { status: 302 });
            return new Response(null, { status: 302, headers: { location: liveRedirect } });
        }
        if (url === CANONICAL) return new Response(null, { status: 404 });

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_REVOKE_UNVERIFIED');
});

test.each([
    ['full share path', 'https://photos.google.com/share/Live?key=Other&hl=en'],
    ['bare share path', 'https://photos.google.com/share'],
    ['user share path', 'https://photos.google.com/u/0/share/Live']
])('a %s redirect on the album URL is not stopped evidence', async (_label, liveRedirect) => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK || url === DELETE_ENVELOPE || url === REMOVE_ALBUM)
            return new Response(null);
        if (url === SHORT_URL) {
            if (init?.redirect === 'follow') return new Response(null, { status: 404 });
            return new Response(null, { status: 404 });
        }
        if (url === CANONICAL)
            return new Response(null, { status: 302, headers: { location: liveRedirect } });

        return new Response(null, { status: 404 });
    };

    const revoked = await revokeShare(revokeRequest(), fetcher, {
        sleep: async () => undefined,
        verifyAttempts: 1
    });

    expect(revoked.unwrapErr().code).toBe('SHARE_REVOKE_UNVERIFIED');
});
