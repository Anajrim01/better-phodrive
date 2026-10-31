import { createHash, randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { FileActionKind, type FileRequest, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { decodeSplitHeader, encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { compressPayload } from '@madkarmaa/phodrive-core/server/compress';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { bmpResponse } from '../helpers/download';
import { encoded, header, NAME } from '../helpers/compression';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    uploadBmp: vi.fn()
}));

test('a compressed chunk downloads as the original bytes', async () => {
    const original = new Uint8Array(2 * 1024 * 1024);
    for (let index = 0; index < original.length; index++) original[index] = index % 251;
    const fileHash = createHash('sha256').update(original).digest('hex');

    const { stored, bmp } = await encoded(original, fileHash, fileHash);
    expect(stored.compressed).toBe(true);

    const sha1 = createHash('sha1').update(bmp).digest('hex');
    const chunk: RemoteBmp = {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: NAME,
        size: original.length,
        storedSize: stored.storedSize,
        compressed: true,
        at: 1,
        mediaKey: 'media-key',
        sha1
    };
    const input: FileRequest = {
        action: FileActionKind.Download,
        email: 'test@example.com',
        token: 'aas_et/test',
        name: NAME,
        fileHash,
        fileId: fileHash,
        chunks: [chunk],
        workers: 1
    };
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) => {
        expect(mediaKey).toBe('media-key');

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });

    try {
        const downloaded = await downloadFile(input);
        const bytes = await downloaded.unwrap().arrayBuffer();

        expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});

test('a corrupt compressed chunk fails the download instead of writing short bytes', async () => {
    const original = new Uint8Array(1024 * 1024);
    for (let index = 0; index < original.length; index++) original[index] = index % 251;
    const fileHash = createHash('sha256').update(original).digest('hex');

    const { stored, bmp } = await encoded(original, fileHash, fileHash);
    expect(stored.compressed).toBe(true);

    const payloadOffset = decodeSplitHeader(bmp, bmp.length).unwrap().payloadOffset;
    bmp[payloadOffset + 10] ^= 0xff;
    const sha1 = createHash('sha1').update(bmp).digest('hex');
    const chunk: RemoteBmp = {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: NAME,
        size: original.length,
        storedSize: stored.storedSize,
        compressed: true,
        at: 1,
        mediaKey: 'media-key',
        sha1
    };
    const input: FileRequest = {
        action: FileActionKind.Download,
        email: 'test@example.com',
        token: 'aas_et/test',
        name: NAME,
        fileHash,
        fileId: fileHash,
        chunks: [chunk],
        workers: 1
    };
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response))
    );

    try {
        const downloaded = await downloadFile(input);

        expect(downloaded.isOk()).toBe(true);
        if (downloaded.isOk())
            await expect(downloaded.unwrap().arrayBuffer()).rejects.toMatchObject({
                code: 'DECOMPRESSION_FAILED'
            });
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});

test('a truncated brotli stream fails through the download reader', async () => {
    const original = new Uint8Array(64 * 1024).fill(3);
    const fileHash = createHash('sha256').update(original).digest('hex');
    const compressed = (await compressPayload(original)).unwrap();
    const truncated = compressed.data.subarray(0, compressed.data.length - 1);
    const split = header(original.length, truncated.length, true, fileHash, fileHash);
    const bmp = encodeSplitBmp(truncated, split).unwrap();
    const sha1 = createHash('sha1').update(bmp).digest('hex');
    const chunk: RemoteBmp = {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: NAME,
        size: original.length,
        storedSize: truncated.length,
        compressed: true,
        at: 1,
        mediaKey: 'truncated',
        sha1
    };
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response))
    );

    try {
        const downloaded = await downloadFile({
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name: NAME,
            fileHash,
            fileId: fileHash,
            chunks: [chunk],
            workers: 1
        });

        expect(downloaded.isOk()).toBe(true);
        if (downloaded.isOk())
            await expect(downloaded.unwrap().arrayBuffer()).rejects.toMatchObject({
                code: 'DECOMPRESSION_FAILED'
            });
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});

test('a stream that expands past the header size fails instead of growing', async () => {
    const expanded = new Uint8Array(64 * 1024).fill(4);
    const compressed = (await compressPayload(expanded)).unwrap();
    const fileHash = createHash('sha256').update(new Uint8Array(1024)).digest('hex');
    const split = header(1024, compressed.storedSize, true, fileHash, fileHash);
    const bmp = encodeSplitBmp(compressed.data, split).unwrap();
    const sha1 = createHash('sha1').update(bmp).digest('hex');
    const chunk: RemoteBmp = {
        fileHash,
        fileId: fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: NAME,
        size: 1024,
        storedSize: compressed.storedSize,
        compressed: true,
        at: 1,
        mediaKey: 'expanded',
        sha1
    };
    vi.mocked(downloadBmp).mockImplementation(() =>
        Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response))
    );

    try {
        const downloaded = await downloadFile({
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name: NAME,
            fileHash,
            fileId: fileHash,
            chunks: [chunk],
            workers: 1
        });

        expect(downloaded.isOk()).toBe(true);
        if (downloaded.isOk())
            await expect(downloaded.unwrap().arrayBuffer()).rejects.toMatchObject({
                code: 'DECOMPRESSION_FAILED'
            });
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});

test('a mixed file downloads one compressed chunk and one raw chunk', async () => {
    const first = new Uint8Array(1024 * 1024).fill(5);
    const second = new Uint8Array(randomBytes(1024 * 1024));
    const original = new Uint8Array(first.length + second.length);
    original.set(first);
    original.set(second, first.length);
    const fileHash = createHash('sha256').update(original).digest('hex');

    const chunks: RemoteBmp[] = [];
    const bmps = new Map<string, Uint8Array>();

    for (const [index, payload] of [first, second].entries()) {
        const stored = (await compressPayload(payload)).unwrap();
        const split = header(
            payload.length,
            stored.storedSize,
            stored.compressed,
            fileHash,
            fileHash,
            index,
            index === 1
        );
        const bmp = encodeSplitBmp(stored.data, split).unwrap();
        const mediaKey = `mixed-${index}`;
        bmps.set(mediaKey, bmp);
        chunks.push({
            fileHash,
            fileId: fileHash,
            chunkIndex: index,
            isLast: index === 1,
            originalName: index === 0 ? NAME : undefined,
            size: payload.length,
            storedSize: stored.storedSize,
            compressed: stored.compressed,
            at: 1,
            mediaKey,
            sha1: createHash('sha1').update(bmp).digest('hex')
        });
    }

    expect(chunks[0].compressed).toBe(true);
    expect(chunks[1].compressed).toBe(false);
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) => {
        const bmp = bmps.get(mediaKey)!;

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });

    try {
        const downloaded = await downloadFile({
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name: NAME,
            fileHash,
            fileId: fileHash,
            chunks,
            workers: 1
        });
        const bytes = await downloaded.unwrap().arrayBuffer();

        expect(Buffer.from(bytes)).toEqual(Buffer.from(original));
    } finally {
        vi.mocked(downloadBmp).mockReset();
    }
});
