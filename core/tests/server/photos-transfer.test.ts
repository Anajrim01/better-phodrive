import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { authResponse, bytes } from '../helpers/photos';
import { downloadBmp, moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

test('download opens the original response stream and trash targets its dedup key', async () => {
    const bmp = Buffer.from('BM test pixels');
    const sha1 = createHash('sha1').update(bmp).digest();
    const signed = 'https://lh3.googleusercontent.com/p/test=d';
    const downloadMetadata = bytes(
        1,
        Buffer.concat([
            bytes(1, 'media-key'),
            bytes(2, bytes(13, bytes(1, sha1))),
            bytes(5, bytes(2, bytes(5, signed)))
        ])
    );
    let step = 0;
    const fakeFetch: Fetcher = async (input, init) => {
        const url = String(input);
        expect(init?.signal).toBeUndefined();
        step++;
        if (step === 1 || step === 4) return authResponse();
        if (step === 2) {
            expect(url).toContain('PhotosPrepareDownload');
            return new Response(Uint8Array.from(downloadMetadata));
        }
        if (step === 3) {
            expect(url).toBe(signed);
            return new Response(Uint8Array.from(bmp), { headers: { 'content-type': 'image/bmp' } });
        }
        expect(url).toContain('17490284929287180316');
        const requestBody = await new Response(init?.body).arrayBuffer();
        const body = Buffer.from(requestBody);
        expect(body.subarray(0, 2)).toEqual(Buffer.from([16, 1]));
        expect(body.includes(Buffer.from(sha1.toString('base64url')))).toBe(true);
        return new Response(Uint8Array.from([]));
    };
    const downloaded = await downloadBmp(
        'test@example.com',
        'aas_et/test',
        'media-key',
        sha1.toString('hex'),
        fakeFetch
    );
    const response = downloaded.unwrap();
    const downloadedBytes = await response.arrayBuffer();
    expect(Buffer.from(downloadedBytes)).toEqual(bmp);
    const deleted = await moveToTrash(
        'test@example.com',
        'aas_et/test',
        sha1.toString('hex'),
        fakeFetch
    );
    expect(deleted.isOk()).toBe(true);
    expect(step).toBe(5);
});

test.each(['stream', 'content-type', 'http'] as const)(
    'photo download %s preserves cancellation and does not buffer the image body',
    async (mode) => {
        const { input, bmps } = downloadFixture();
        const chunk = input.chunks[0];
        const metadata = bytes(
            1,
            Buffer.concat([
                bytes(1, chunk.mediaKey),
                bytes(2, bytes(13, bytes(1, Buffer.from(chunk.sha1, 'hex')))),
                bytes(5, bytes(2, bytes(5, 'https://lh3.googleusercontent.com/stream=d')))
            ])
        );
        const cancelled = vi.fn();
        const read = vi.fn();
        const raw = bmpResponse(bmps[0], 256, { onRead: read, onCancel: cancelled });
        const response = new Response(raw.body, {
            status: mode === 'http' ? 503 : 200,
            headers: { 'content-type': mode === 'content-type' ? 'text/plain' : 'image/bmp' }
        });
        const responses = [authResponse(), new Response(Uint8Array.from(metadata)), response];
        const abort = new AbortController();
        const fetcher: Fetcher = async (_url, init) => {
            expect(init?.signal).toBe(abort.signal);
            return responses.shift()!;
        };

        const downloaded = await downloadBmp(
            input.email,
            input.token,
            chunk.mediaKey,
            chunk.sha1,
            fetcher,
            abort.signal
        );
        expect(read).not.toHaveBeenCalled();
        if (mode === 'stream') {
            expect(downloaded.unwrap()).toBe(response);
            await downloaded.unwrap().body!.cancel();
        } else {
            expect(downloaded.isErr()).toBe(true);
        }
        expect(cancelled).toHaveBeenCalledOnce();
    }
);
