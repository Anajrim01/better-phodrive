import { describe, expect, it } from 'vitest';
import { handleAlbum } from '../functions/_lib/album';
import { createBytesHandler } from '../functions/_lib/bytes';

const album = process.env.SHARED_LIVE_ALBUM;

describe('live public album', () => {
    it.skipIf(!album)('lists an album without a login', async () => {
        const response = await handleAlbum(
            new Request('https://shared.phodrive.dev/api/album', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ album })
            })
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.count).toBeGreaterThan(0);
        expect(body.items.length).toBe(body.count);

        for (const item of body.items) {
            expect(new URL(item.url).hostname).toBe('lh3.googleusercontent.com');
            expect(item.downloadUrl.endsWith('=d')).toBe(true);
        }
    });

    it.skipIf(!album)('streams a range from a public original', async () => {
        const albumResponse = await handleAlbum(
            new Request('https://shared.phodrive.dev/api/album', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ album })
            })
        );
        const listing = await albumResponse.json();
        const handler = createBytesHandler();
        const response = await handler(
            new Request('https://shared.phodrive.dev/api/bytes', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    url: listing.items[0].downloadUrl,
                    range: 'bytes=0-65535'
                })
            })
        );
        const bytes = new Uint8Array(await response.arrayBuffer());

        expect(response.status).toBe(206);
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect(response.headers.get('content-disposition')).toContain('attachment');
        expect(bytes.length).toBeGreaterThan(0);
        expect(bytes.length).toBeLessThanOrEqual(65_536);
    });
});
