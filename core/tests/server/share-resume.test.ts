import { expect, test } from 'vitest';
import { createShare } from '@madkarmaa/phodrive-core/server/share';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    ALBUM_KEY,
    AUTH_RESPONSE,
    bodyResponse,
    CANONICAL,
    ENVELOPE_KEY,
    EXISTING_SHARE,
    linkResponse,
    protobuf,
    request,
    requestState,
    SHORT_URL,
    UPDATE_LINK
} from '../helpers/share';

test('resume disables the old link when state 2 never becomes visible', async () => {
    let state = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK) {
            state = requestState(protobuf(init?.body));
            return state === 2 ? bodyResponse(linkResponse(SHORT_URL)) : new Response(null);
        }
        if (url === SHORT_URL) return new Response(null, { status: 404 });
        if (url === CANONICAL) return new Response(null, { status: 404 });

        return new Response(null, { status: 404 });
    };

    const created = await createShare(
        request({ existing: EXISTING_SHARE, files: undefined }),
        fetcher,
        { poll: { attempts: 1, delayMs: 0, sleep: async () => undefined }, retryDelayMs: 0 }
    );

    expect(created.unwrapErr().code).toBe('SHARE_LINK_NOT_LIVE');
    expect(state).toBe(1);
});

test('resume returns recovery keys when the old link cannot be disabled', async () => {
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) return new Response(AUTH_RESPONSE);
        if (url === UPDATE_LINK) {
            return requestState(protobuf(init?.body)) === 1
                ? new Response(null, { status: 500 })
                : bodyResponse(linkResponse(SHORT_URL));
        }
        if (url === SHORT_URL || url === CANONICAL) return new Response(null, { status: 404 });

        return new Response(null, { status: 404 });
    };

    const created = await createShare(
        request({ existing: EXISTING_SHARE, files: undefined }),
        fetcher,
        { poll: { attempts: 1, delayMs: 0, sleep: async () => undefined }, retryDelayMs: 0 }
    );
    const error = created.unwrapErr();

    expect(error.code).toBe('SHARE_REVOKE_UNVERIFIED');
    expect('recovery' in error ? error.recovery : null).toEqual({
        envelopeKey: ENVELOPE_KEY,
        albumKey: ALBUM_KEY
    });
});
