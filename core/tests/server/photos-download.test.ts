import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    downloadBmp,
    mutatePhotos,
    createThrottleCoordinator
} from '@madkarmaa/phodrive-core/server/photos';
import { preparedDownloadUrl } from '@madkarmaa/phodrive-core/server/photos/download';
import { bytesField, message, numberField } from '@madkarmaa/phodrive-core/server/protobuf';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { authResponse, downloadMetadata, imageDownload } from '../helpers/protobuf';

const MEDIA_KEY = 'fixture-key';
const SHA1 = 'a'.repeat(40);
const SIGNED_URL = 'https://lh3.googleusercontent.com/fixture=d';

function metadata(download: Buffer, key = MEDIA_KEY, sha1 = SHA1): Buffer {
    return bytesField(
        1,
        message(
            bytesField(1, key),
            bytesField(2, bytesField(13, bytesField(1, Buffer.from(sha1, 'hex')))),
            bytesField(5, download)
        )
    );
}

function parse(response: Buffer) {
    const fetcher: Fetcher = async () => new Response(Uint8Array.from(response));

    return preparedDownloadUrl(MEDIA_KEY, SHA1, {}, fetcher);
}

test('image download metadata preserves the validated signed URL', async () => {
    const response = metadata(message(numberField(1, 1), bytesField(2, bytesField(5, SIGNED_URL))));
    const parsed = await parse(response);

    expect(parsed.unwrap()?.href).toBe(SIGNED_URL);
});

test.each([1, 2, 3, 4, 5])('image download metadata accepts lh%i', async (host) => {
    const signed = `https://lh${host}.googleusercontent.com/fixture=d`;
    const parsed = await parse(metadata(bytesField(2, bytesField(5, signed))));

    expect(parsed.unwrap()?.href).toBe(signed);
});

test.each([
    'https://lh6.googleusercontent.com/fixture=d',
    'https://lh0.googleusercontent.com/fixture=d',
    'https://other.googleusercontent.com/fixture=d',
    'https://googleusercontent.com/fixture=d',
    'https://lh3.googleusercontent.com.example.com/fixture=d',
    'http://lh3.googleusercontent.com/fixture=d',
    'https://lh3.googleusercontent.com:8443/fixture=d',
    'https://user:secret@lh3.googleusercontent.com/fixture=d',
    'https://lh3.googleusercontent.com/fixture=d#fragment'
])('image download metadata rejects %s', async (signed) => {
    const parsed = await parse(metadata(bytesField(2, bytesField(5, signed))));

    expect(parsed.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_DOWNLOAD_URL);
});

test('video download metadata is skipped only after verifying its key and fingerprint', async () => {
    const video = message(numberField(1, 2), bytesField(3, bytesField(5, 'video-download')));
    const parsed = await parse(metadata(video));
    const wrongKey = await parse(metadata(video, 'other-key'));
    const wrongHash = await parse(metadata(video, MEDIA_KEY, 'b'.repeat(40)));

    expect(parsed.unwrap()).toBeNull();
    expect(wrongKey.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_MEDIA_MISMATCH);
    expect(wrongHash.unwrapErr()).toEqual(SERVER_ERRORS.DOWNLOAD_FINGERPRINT_MISMATCH);
});

test.each([
    message(numberField(1, 1)),
    message(numberField(1, 2)),
    message(numberField(1, 2), numberField(1, 2), bytesField(3, '')),
    message(numberField(1, 2), bytesField(3, Uint8Array.of(10, 5, 1))),
    message(numberField(1, 99), bytesField(2, bytesField(5, SIGNED_URL)))
])('invalid download variants remain failures', async (download) => {
    const parsed = await parse(metadata(download));

    expect(parsed.isErr()).toBe(true);
});

test('image download metadata rejects untrusted hosts', async () => {
    const response = metadata(bytesField(2, bytesField(5, 'https://example.com/fixture')));
    const parsed = await parse(response);

    expect(parsed.unwrapErr()).toEqual(SERVER_ERRORS.INVALID_DOWNLOAD_URL);
});

test('download opens the original response stream and trash targets its dedup key', async () => {
    const bmp = Buffer.from('BM test pixels');
    const sha1 = createHash('sha1').update(bmp).digest();
    const signed = 'https://lh3.googleusercontent.com/p/test=d';
    const metadata = downloadMetadata('media-key', sha1, imageDownload(signed));
    let step = 0;
    const fakeFetch: Fetcher = async (input, init) => {
        const url = String(input);
        expect(init?.signal).toBeUndefined();
        step++;
        if (step === 1 || step === 4) return authResponse();
        if (step === 2) {
            expect(url).toContain('PhotosPrepareDownload');
            return new Response(Uint8Array.from(metadata));
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

        return new Response(
            Uint8Array.from(
                message(
                    bytesField(1, 'media-key'),
                    bytesField(2, message(bytesField(1, 'media-key')))
                )
            )
        );
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
    const deleted = await mutatePhotos(
        'trash',
        { email: 'test@example.com', token: 'aas_et/test' },
        [{ mediaKey: 'media-key', sha1: sha1.toString('hex') }],
        { key: 'account-a', coordinator: createThrottleCoordinator() },
        fakeFetch
    );
    expect(deleted.unwrap().applied).toHaveLength(1);
    expect(step).toBe(5);
});

test.each(['stream', 'content-type', 'http'] as const)(
    'photo download %s preserves cancellation and does not buffer the image body',
    async (mode) => {
        const { input, bmps } = downloadFixture();
        const chunk = input.chunks[0];
        const metadata = downloadMetadata(
            chunk.mediaKey,
            Buffer.from(chunk.sha1, 'hex'),
            imageDownload('https://lh3.googleusercontent.com/stream=d')
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
