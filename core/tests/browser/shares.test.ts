import { afterEach, expect, test, vi } from 'vitest';
import { requestShareCreate, requestShareRevoke } from '@madkarmaa/phodrive-core/browser/shares';
import type {
    ShareCreateRequest,
    ShareCreateResponse,
    ShareRevokeRequest,
    ShareRevokeResponse
} from '@madkarmaa/phodrive-core/share-models';

const EMAIL = 'owner@example.com';
const TOKEN = 'aas_et/fixture';
const CREATE_REQUEST: ShareCreateRequest = {
    action: 'create',
    email: EMAIL,
    token: TOKEN,
    name: 'notes',
    files: [
        {
            id: 'a'.repeat(64),
            name: 'notes.txt',
            chunks: [{ index: 0, mediaKey: 'media-0' }]
        }
    ]
};
const CREATE_RESPONSE: ShareCreateResponse = {
    record: {
        name: 'notes',
        envelopeKey: 'AF1QipEnvelope',
        albumKey: 'AF1QipAlbum',
        shortUrl: 'https://photos.app.goo.gl/abc123',
        albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        authKey: 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR',
        shareUrl: 'https://shared.phodrive.dev/#share=eyJ2IjoxfQ',
        createdAt: 1_700_000_000_000
    },
    manifest: {
        v: 1,
        album: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        files: [{ id: 'a'.repeat(64), chunks: 1, name: 'notes.txt' }]
    }
};
const REVOKE_REQUEST: ShareRevokeRequest = {
    action: 'revoke',
    email: EMAIL,
    token: TOKEN,
    envelopeKey: 'AF1QipEnvelope',
    albumKey: 'AF1QipAlbum',
    shortUrl: 'https://photos.app.goo.gl/abc123',
    albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1'
};
const REVOKE_RESPONSE: ShareRevokeResponse = {
    revoked: true,
    shortUrlStatus: 404,
    albumUrlStatus: 404,
    directUrlStatus: 404,
    envelopeDeleted: true,
    albumRemoved: true
};

afterEach(() => vi.restoreAllMocks());

test('create parses a successful response and posts JSON', async () => {
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json(CREATE_RESPONSE));

    const result = await requestShareCreate(CREATE_REQUEST);

    expect(result.unwrap()).toEqual(CREATE_RESPONSE);
    expect(fetchMock).toHaveBeenCalledWith('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(CREATE_REQUEST)
    });
});

test('create keeps the server code and recovery keys for an uncertain link', async () => {
    const recovery = { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(
            {
                code: 'SHARE_LINK_UNCERTAIN',
                error: 'The share link may still be public.',
                recovery
            },
            { status: 400 }
        )
    );

    const error = (await requestShareCreate(CREATE_REQUEST)).unwrapErr();

    expect(error.code).toBe('SHARE_LINK_UNCERTAIN');
    expect(error.recovery).toEqual(recovery);
});

test('create keeps the exact failure code when the link is not live or too long', async () => {
    const codes = ['SHARE_LINK_NOT_LIVE', 'SHARE_URL_TOO_LONG'];

    for (const code of codes) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            Response.json({ code, error: `${code} message` }, { status: 400 })
        );

        const error = (await requestShareCreate(CREATE_REQUEST)).unwrapErr();

        expect(error.code).toBe(code);
        expect(error.message).toBe(`${code} message`);
    }
});

test('revoke parses a verified response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(REVOKE_RESPONSE));

    const result = await requestShareRevoke(REVOKE_REQUEST);

    expect(result.unwrap()).toEqual(REVOKE_RESPONSE);
});

test('revoke keeps the exact failure code and recovery keys', async () => {
    const recovery = { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(
            { code: 'SHARE_REVOKE_UNVERIFIED', error: 'Retry revoke.', recovery },
            { status: 400 }
        )
    );

    const error = (await requestShareRevoke(REVOKE_REQUEST)).unwrapErr();

    expect(error.code).toBe('SHARE_REVOKE_UNVERIFIED');
    expect(error.recovery).toEqual(recovery);
});

test('a still live revoke keeps its code without recovery keys', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(
            {
                code: 'SHARE_LINK_STILL_LIVE',
                error: 'The old share link is still serving.'
            },
            { status: 400 }
        )
    );

    const error = (await requestShareRevoke(REVOKE_REQUEST)).unwrapErr();

    expect(error.code).toBe('SHARE_LINK_STILL_LIVE');
    expect(error.recovery).toBeUndefined();
});

test('a throttled response keeps its wait time', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        Response.json(
            {
                code: 'THROTTLED',
                error: 'Too many requests. Wait 30 seconds and try again.',
                retryAfterSeconds: 30
            },
            { status: 429 }
        )
    );

    const error = (await requestShareCreate(CREATE_REQUEST)).unwrapErr();

    expect(error.code).toBe('THROTTLED');
    expect(error.retryAfterSeconds).toBe(30);
});

test('network and malformed responses fail with the shared fallback message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network unavailable'));

    const network = (await requestShareCreate(CREATE_REQUEST)).unwrapErr();
    expect(network.code).toBe('REQUEST_FAILED');
    expect(network.message).toBe('Could not update the share.');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json'));

    const malformed = (await requestShareCreate(CREATE_REQUEST)).unwrapErr();
    expect(malformed.code).toBe('REQUEST_FAILED');
});
