import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import type {
    ShareCreateResponse,
    ShareRevokeResponse
} from '@madkarmaa/phodrive-core/share-models';
import { createShare, revokeShare } from '@madkarmaa/phodrive-core/server/share';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { POST } from '../../src/routes/api/share/+server';

vi.mock('@madkarmaa/phodrive-core/server/share', () => ({
    createShare: vi.fn(),
    revokeShare: vi.fn()
}));

const CREATE_BODY = {
    action: 'create',
    email: 'owner@example.com',
    token: 'aas_et/test',
    name: 'Holiday photos',
    files: [
        { id: 'a'.repeat(64), name: 'photo.jpg', chunks: [{ index: 0, mediaKey: 'media-key' }] }
    ]
};
const SHARE_RESPONSE: ShareCreateResponse = {
    record: {
        name: 'Holiday photos',
        envelopeKey: 'AF1QipEnvelope',
        albumKey: 'AF1QipAlbum',
        shortUrl: 'https://photos.app.goo.gl/abc123',
        albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        authKey: 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR',
        shareUrl: 'https://shared.phodrive.dev/#share=AbCdEf',
        createdAt: 1_700_000_000_000
    },
    manifest: {
        v: 1,
        album: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
        files: [{ id: 'a'.repeat(64), chunks: 1, name: 'photo.jpg' }]
    }
};
const REVOKE_RESPONSE: ShareRevokeResponse = {
    revoked: true,
    shortUrlStatus: 404,
    albumUrlStatus: 404,
    directUrlStatus: 302,
    envelopeDeleted: true,
    albumRemoved: true
};

beforeEach(() => {
    vi.clearAllMocks();
});

async function post(body: unknown): Promise<Response> {
    return POST({
        request: new Request('http://localhost/api/share', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })
    } as Parameters<typeof POST>[0]);
}

test('create requests are validated and dispatched to the share service', async () => {
    vi.mocked(createShare).mockImplementation(() =>
        Ok(SHARE_RESPONSE).andThenAsync(async (value) => Ok(value))
    );

    const response = await post(CREATE_BODY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SHARE_RESPONSE);
    expect(createShare).toHaveBeenCalledWith(CREATE_BODY);
});

test('revoke requests are dispatched to the share service', async () => {
    vi.mocked(revokeShare).mockImplementation(() =>
        Ok(REVOKE_RESPONSE).andThenAsync(async (value) => Ok(value))
    );

    const response = await post({
        action: 'revoke',
        email: 'owner@example.com',
        token: 'aas_et/test',
        envelopeKey: 'envelope',
        albumKey: 'album'
    });

    expect(response.status).toBe(200);
    expect(revokeShare).toHaveBeenCalledOnce();
});

test('invalid bodies never reach the share service', async () => {
    const missingToken = await post({ ...CREATE_BODY, token: undefined });
    expect(missingToken.status).toBe(400);
    expect(createShare).not.toHaveBeenCalled();

    const badAction = await post({ ...CREATE_BODY, action: 'publish' });
    expect(badAction.status).toBe(400);
    expect(createShare).not.toHaveBeenCalled();
    expect(revokeShare).not.toHaveBeenCalled();
});

test('a cleanup failure returns recovery keys to the owner', async () => {
    const failure: ServerError = {
        code: 'SHARE_LINK_UNCERTAIN',
        message: 'The share link may still be public.',
        recovery: { envelopeKey: 'envelope', albumKey: 'album' }
    };
    vi.mocked(createShare).mockImplementation(() =>
        Err(failure).andThenAsync(async (value) => Ok(value))
    );

    const response = await post(CREATE_BODY);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.recovery).toEqual({ envelopeKey: 'envelope', albumKey: 'album' });
});
