import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAlbum } from '../functions/_lib/album';
import { albumBody, startMockGoogle, type MockAlbum, type MockGoogle } from './helpers/mock-google';

const baseAlbum: MockAlbum = {
    uid: 'AF1QipTestAlbum0000000000000000000000000000000000000000000',
    key: 'testCapabilityKey0000000000000000000000000000',
    title: 'Research album',
    items: [
        {
            uid: 'AF1QipNhq-tCHw73FJ75ajmBIdUaaJKRnrbq2tiMU8sU',
            url: 'https://lh3.googleusercontent.com/pw/token-one-abcdefghijklmnop',
            width: 1280,
            height: 720
        },
        {
            uid: 'AF1QipPoY2unBIAHEgKJPjPAoPhBXEIdtcltq-X5AWV2',
            url: 'https://lh3.googleusercontent.com/pw/token-two-abcdefghijklmnop=d'
        }
    ]
};

let server: MockGoogle | undefined;

afterEach(async () => {
    await server?.close();
    server = undefined;
});

function request(body: string): Request {
    return new Request('https://shared.phodrive.dev/api/album', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
    });
}

describe('POST /api/album', () => {
    it('returns normalized items and original download URLs', async () => {
        server = await startMockGoogle(baseAlbum);
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.title).toBe('Research album');
        expect(body.count).toBe(2);
        expect(body.items[0]).toEqual({
            id: baseAlbum.items[0].uid,
            url: 'https://lh3.googleusercontent.com/pw/token-one-abcdefghijklmnop',
            downloadUrl: 'https://lh3.googleusercontent.com/pw/token-one-abcdefghijklmnop=d',
            width: 1280,
            height: 720
        });
        expect(body.items[1].downloadUrl).toBe(
            'https://lh3.googleusercontent.com/pw/token-two-abcdefghijklmnop=d'
        );
        expect(server.rpcBodies).toHaveLength(1);
        expect(server.rpcBodies[0]).toContain('snAcKc');
    });

    it('falls back to AF_initDataCallback when the RPC is absent', async () => {
        server = await startMockGoogle({ ...baseAlbum, omitRpc: true });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });

        expect(response.status).toBe(200);
        expect((await response.json()).items).toHaveLength(2);
        expect(server.rpcBodies).toHaveLength(0);
    });

    it('falls back when service metadata is malformed', async () => {
        server = await startMockGoogle({ ...baseAlbum, corruptRpc: true });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });

        expect(response.status).toBe(200);
        expect((await response.json()).items).toHaveLength(2);
        expect(server.rpcBodies).toHaveLength(0);
    });

    it('falls back when the RPC fails', async () => {
        server = await startMockGoogle({ ...baseAlbum, batchMode: 'http500' });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });

        expect(response.status).toBe(200);
        expect((await response.json()).items).toHaveLength(2);
    });

    it('fails closed when both listings are missing', async () => {
        server = await startMockGoogle({ ...baseAlbum, omitRpc: true, omitInit: true });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body.error.code).toBe('ALBUM_SHAPE_CHANGED');
    });

    it('fails closed when the declared count and items disagree', async () => {
        server = await startMockGoogle({ ...baseAlbum, declaredCount: 3 });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body.error.code).toBe('ALBUM_INCOMPLETE');
    });

    it('fails closed when an item shape is wrong', async () => {
        server = await startMockGoogle({
            ...baseAlbum,
            itemTransform: (item) => [item.uid, ['http://evil.example/pw/token'], 0]
        });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });
        const body = await response.json();

        expect(response.status).toBe(502);
        expect(body.error.code).toBe('ALBUM_SHAPE_CHANGED');
    });

    it('rejects a non canonical album URL', async () => {
        const response = await handleAlbum(
            request(JSON.stringify({ album: 'https://photos.app.goo.gl/short' })),
            { fetch: globalThis.fetch, pageOrigin: 'https://photos.google.com' }
        );

        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_ALBUM');
    });

    it('maps a missing album to 404', async () => {
        server = await startMockGoogle({ ...baseAlbum, key: 'different-key-value' });
        const response = await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });

        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe('ALBUM_UNAVAILABLE');
    });

    it('does not log the album URL or capability key', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        server = await startMockGoogle(baseAlbum);

        await handleAlbum(request(albumBody(baseAlbum)), {
            fetch: globalThis.fetch,
            pageOrigin: server.origin
        });

        const output = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
        expect(output).not.toContain(baseAlbum.uid);
        expect(output).not.toContain(baseAlbum.key);
        log.mockRestore();
        error.mockRestore();
    });
});
