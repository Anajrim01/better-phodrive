import { createHash, randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import Varint from 'varint';
import {
    FileActionKind,
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    SplitHeaderSchema,
    type FileRequest,
    type RemoteBmp,
    type SplitHeader
} from '@madkarmaa/phodrive-core/models';
import {
    decodeSplitHeader,
    encodeSplitBmp,
    MAX_CHUNK_PAYLOAD_BYTES
} from '@madkarmaa/phodrive-core/server/bmp';
import { decodeSplitBmp } from '../helpers/bmp';
import {
    COMPRESSION_MIN_BYTES,
    COMPRESSION_MIN_SAVING,
    compressionSavesEnough,
    compressPayload,
    decompressPayload
} from '@madkarmaa/phodrive-core/server/compress';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { encoded, header, FILE_HASH, FILE_ID, NAME } from '../helpers/compression';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { bmpResponse } from '../helpers/download';
import { uploadForm } from '../helpers/upload';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    uploadBmp: vi.fn()
}));

test.each([0, 1, 64 * 1024, 8 * 1024 * 1024])(
    'compressible %i-byte chunks round-trip through the split BMP',
    { timeout: 60_000 },
    async (size) => {
        const payload = new Uint8Array(size);
        for (let index = 0; index < size; index++) payload[index] = index % 29;
        const { stored, split, bmp } = await encoded(payload);

        expect(stored.originalSize).toBe(size);
        expect(stored.storedSize).toBe(stored.data.length);
        expect(decodeSplitHeader(bmp, bmp.length).unwrap().header).toEqual(split);
        const decoded = decodeSplitBmp(bmp).unwrap();
        expect(Buffer.from(decoded.payload)).toEqual(Buffer.from(payload));
        expect(decoded.header.payloadSize).toBe(stored.storedSize);
    }
);

test(
    'a full 195 MB chunk round-trips without exceeding the photo limit',
    { timeout: 120_000 },
    async () => {
        const payload = new Uint8Array(MAX_CHUNK_PAYLOAD_BYTES).fill(42);
        const { stored, bmp } = await encoded(payload);

        expect(stored.compressed).toBe(true);
        expect(stored.storedSize).toBeLessThan(payload.length / 10);
        expect(bmp.length).toBeLessThan(200_000_000);
        const decoded = decodeSplitBmp(bmp).unwrap();
        expect(decoded.payload.length).toBe(payload.length);
        expect(decoded.payload[0]).toBe(42);
        expect(decoded.payload[decoded.payload.length - 1]).toBe(42);
    }
);

test.each([0, 1, 64 * 1024, 8 * 1024 * 1024, MAX_CHUNK_PAYLOAD_BYTES])(
    'incompressible %i-byte chunks stay raw',
    { timeout: 120_000 },
    async (size) => {
        const payload = new Uint8Array(randomBytes(size));
        const { stored, split, bmp } = await encoded(payload);

        expect(stored.compressed).toBe(false);
        expect(stored.storedSize).toBe(payload.length);
        expect(stored.data).toBe(payload);
        expect(split.originalSize).toBeUndefined();
        const decoded = decodeSplitBmp(bmp).unwrap();
        expect(decoded.payload.length).toBe(payload.length);
        if (size <= 8 * 1024 * 1024) {
            expect(Buffer.from(decoded.payload)).toEqual(Buffer.from(payload));
        } else {
            expect(createHash('sha256').update(decoded.payload).digest('hex')).toBe(
                createHash('sha256').update(payload).digest('hex')
            );
        }
    }
);

test('the ratio threshold is five percent', () => {
    expect(COMPRESSION_MIN_SAVING).toBe(0.05);
});

test('chunks below four kilobytes stay raw even when repetitive', async () => {
    const payload = new Uint8Array(1024).fill(1);
    const { stored } = await encoded(payload);

    expect(COMPRESSION_MIN_BYTES).toBe(4 * 1024);
    expect(stored.compressed).toBe(false);
    expect(stored.storedSize).toBe(payload.length);
});

test('the size floor is exact at 4095 and 4096 bytes', async () => {
    const below = await compressPayload(new Uint8Array(4095).fill(1));
    const at = await compressPayload(new Uint8Array(4096).fill(1));

    expect(below.unwrap().compressed).toBe(false);
    expect(at.unwrap().compressed).toBe(true);
});

test('the saving threshold is exact at five percent', () => {
    expect(compressionSavesEnough(100, 95)).toBe(true);
    expect(compressionSavesEnough(100, 96)).toBe(false);
    expect(compressionSavesEnough(1000, 950)).toBe(true);
    expect(compressionSavesEnough(1000, 951)).toBe(false);
});

test('a compressible prefix with a random tail still compresses', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    payload.fill(1, 0, payload.length / 2);
    payload.set(randomBytes(payload.length / 2), payload.length / 2);
    const fixture = uploadForm(payload, 'proof.bin', { compress: true });
    const input = (await receiveUpload(fixture.request())).unwrap();
    const source = (await encodeUploadBmp(input)).unwrap();

    expect(source.compressed).toBe(true);
    expect((await source.drain()).isOk()).toBe(true);
    await input.cancel();
});

test('the buffered codec sees a compressible tail after a random prefix', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    payload.set(randomBytes(payload.length / 2), 0);
    payload.fill(1, payload.length / 2);
    const result = await compressPayload(payload);

    expect(result.unwrap().compressed).toBe(true);
});

test('a request without compress keeps the raw streaming path', async () => {
    const payload = new Uint8Array(64 * 1024).fill(7);
    const fixture = uploadForm(payload);
    const input = (await receiveUpload(fixture.request())).unwrap();
    const source = (await encodeUploadBmp(input)).unwrap();

    expect(source.compressed).toBe(false);
    expect(source.length).toBe(input.bmp.totalSize);
    expect(source.sha1).toBe(fixture.metadata.sha1);
    expect((await source.drain()).isOk()).toBe(true);
    await input.cancel();
});

test('compress: true stores a compressible chunk and round-trips', async () => {
    const payload = new Uint8Array(64 * 1024).fill(7);
    const fixture = uploadForm(payload, 'proof.bin', { compress: true });
    const input = (await receiveUpload(fixture.request())).unwrap();
    const source = (await encodeUploadBmp(input)).unwrap();

    expect(source.compressed).toBe(true);
    expect(source.storedSize).toBeLessThan(payload.length / 2);
    expect((await source.drain()).isOk()).toBe(true);
    await input.cancel();
});

test('a truncated brotli stream is rejected with a decompression error', async () => {
    const payload = new Uint8Array(64 * 1024).fill(3);
    const { stored } = await encoded(payload);
    const truncated = stored.data.subarray(0, stored.data.length - 1);

    const result = await decompressPayload(truncated, stored.originalSize);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.unwrapErr().code).toBe('DECOMPRESSION_FAILED');
});

test('the flags bitfield requires originalSize exactly when compression is set', () => {
    const plain = header(100, 100, false);
    expect(SplitHeaderSchema.safeParse(plain).success).toBe(true);
    expect(SplitHeaderSchema.safeParse({ ...plain, flags: SPLIT_FLAG_LAST | 2 }).success).toBe(
        false
    );
    expect(SplitHeaderSchema.safeParse({ ...plain, originalSize: 120 }).success).toBe(false);
    expect(SplitHeaderSchema.safeParse(header(120, 100, true)).success).toBe(true);
    expect(
        SplitHeaderSchema.safeParse({ ...header(120, 100, true), originalSize: 99 }).success
    ).toBe(false);
    expect(SplitHeaderSchema.safeParse({ ...plain, flags: 4 }).success).toBe(false);
    expect(
        SplitHeaderSchema.safeParse({
            ...header(MAX_CHUNK_PAYLOAD_BYTES, 100, true),
            originalSize: MAX_CHUNK_PAYLOAD_BYTES + 1
        }).success
    ).toBe(false);
    expect(
        SplitHeaderSchema.safeParse({
            ...plain,
            payloadSize: MAX_CHUNK_PAYLOAD_BYTES + 1
        }).success
    ).toBe(false);
});

test('a corrupt compressed stream fails instead of returning damaged bytes', async () => {
    const payload = new Uint8Array(64 * 1024).fill(7);
    const { split, bmp } = await encoded(payload);
    const prefix = decodeSplitHeader(bmp, bmp.length).unwrap().payloadOffset;
    bmp[prefix + 10] ^= 0xff;

    expect(decodeSplitBmp(bmp).isErr()).toBe(true);
});

test('a cleared compression flag is rejected', async () => {
    const payload = new Uint8Array(64 * 1024).fill(9);
    const { bmp } = await encoded(payload);
    const flagsOffset = 54 + 'BMSPLIT\x01'.length + 2 * 32 + Varint.encodingLength(0);
    bmp[flagsOffset] &= ~SPLIT_FLAG_COMPRESSED;

    expect(decodeSplitBmp(bmp).isErr()).toBe(true);
});

test('a compressed chunk with the wrong original size is rejected', async () => {
    const payload = new Uint8Array(64 * 1024).fill(3);
    const { stored } = await encoded(payload);
    const decompressed = await decompressPayload(stored.data, stored.originalSize + 1);

    expect(decompressed.isErr()).toBe(true);
});

test('a legacy version 1 chunk without the compressed flag still decodes', () => {
    const prefix = Buffer.from(
        '424d360c000000000000360000002800000020000000200000000100180000000000000c000000000000000000000000000000000000424d53504c495401' +
            'ab'.repeat(32) +
            'cd'.repeat(32) +
            '000180080f70686f746f732df09f93b72e62696e',
        'hex'
    );
    const payload = new Uint8Array(1024).fill(0x5a);
    const bmp = Buffer.alloc(3126);
    prefix.copy(bmp);
    bmp.set(payload, prefix.length);

    const decoded = decodeSplitBmp(bmp).unwrap();
    expect(decoded.header).toEqual({
        fileHash: 'ab'.repeat(32),
        fileId: 'cd'.repeat(32),
        chunkIndex: 0,
        flags: 1,
        payloadSize: 1024,
        fileName: 'photos-📷.bin'
    });
    expect(Buffer.from(decoded.payload)).toEqual(Buffer.from(payload));
});
