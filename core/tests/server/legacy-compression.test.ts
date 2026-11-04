import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    SplitHeaderSchema,
    RemoteBmpSchema,
    splitHeaderIsCompressed,
    splitHeaderIsLast
} from '@madkarmaa/phodrive-core/models';
import { decodeSplitHeader, splitHeaderByteLength } from '@madkarmaa/phodrive-core/server/bmp';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { decodeSplitBmp } from '../helpers/split-bmp';
import {
    fixtureBmp,
    fixtureContent,
    LEGACY_FOLDER_V2,
    LEGACY_FOLDER_V2_TAIL,
    LEGACY_ROOT_V1
} from '../fixtures/legacy-compression';

test('legacy root v1 compressed-last header keeps originalSize before the file name', () => {
    const prefix = Buffer.from(LEGACY_ROOT_V1.prefixHex, 'hex');
    expect(prefix.toString('hex')).toBe(LEGACY_ROOT_V1.prefixHex);
    const decoded = decodeSplitHeader(prefix, LEGACY_ROOT_V1.totalSize).unwrap();

    expect(decoded.payloadOffset).toBe(142);
    expect(decoded.header).toEqual({
        fileHash: LEGACY_ROOT_V1.fileHash,
        fileId: LEGACY_ROOT_V1.fileId,
        chunkIndex: 0,
        flags: 3,
        payloadSize: LEGACY_ROOT_V1.payloadSize,
        originalSize: LEGACY_ROOT_V1.originalSize,
        fileName: LEGACY_ROOT_V1.fileName
    });
    expect(splitHeaderIsLast(decoded.header.flags)).toBe(true);
    expect(splitHeaderIsCompressed(decoded.header.flags)).toBe(true);
    expect(splitHeaderByteLength(decoded.header).unwrap()).toBe(142);
});

test('legacy folder v2 compressed header keeps originalSize before name and folder', () => {
    const prefix = Buffer.from(LEGACY_FOLDER_V2.prefixHex, 'hex');
    expect(prefix.toString('hex')).toBe(LEGACY_FOLDER_V2.prefixHex);
    const decoded = decodeSplitHeader(prefix, LEGACY_FOLDER_V2.totalSize).unwrap();

    expect(decoded.payloadOffset).toBe(156);
    expect(decoded.header).toEqual({
        fileHash: LEGACY_FOLDER_V2.fileHash,
        fileId: LEGACY_FOLDER_V2.fileId,
        chunkIndex: 0,
        flags: 2,
        payloadSize: LEGACY_FOLDER_V2.payloadSize,
        originalSize: LEGACY_FOLDER_V2.originalSize,
        fileName: LEGACY_FOLDER_V2.fileName,
        folder: LEGACY_FOLDER_V2.folder
    });
    expect(splitHeaderIsLast(decoded.header.flags)).toBe(false);
    expect(splitHeaderIsCompressed(decoded.header.flags)).toBe(true);
    expect(splitHeaderByteLength(decoded.header).unwrap()).toBe(156);
});

test('fixed legacy fixtures decode to their known original content and stored BMP hashes', () => {
    for (const fixture of [LEGACY_ROOT_V1, LEGACY_FOLDER_V2, LEGACY_FOLDER_V2_TAIL]) {
        const bmp = fixtureBmp(fixture);
        const decoded = decodeSplitBmp(bmp).unwrap();

        expect(bmp.length).toBe(fixture.totalSize);
        expect(createHash('sha256').update(bmp).digest('hex')).toBe(fixture.bmpSha256);
        expect(createHash('sha1').update(bmp).digest('hex')).toBe(fixture.sha1);
        expect(Buffer.from(decoded.payload).equals(fixtureContent(fixture))).toBe(true);
        expect(
            Buffer.from(decoded.storedPayload).equals(Buffer.from(fixture.payloadHex, 'hex'))
        ).toBe(true);
    }
});

test('compression flags are a bitfield and originalSize is required exactly when compressed', () => {
    const base = {
        fileHash: LEGACY_ROOT_V1.fileHash,
        fileId: LEGACY_ROOT_V1.fileId,
        chunkIndex: 0,
        payloadSize: 10,
        fileName: 'a.bin'
    };

    expect(SplitHeaderSchema.safeParse({ ...base, flags: 0 }).success).toBe(true);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 1 }).success).toBe(true);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 2, originalSize: 20 }).success).toBe(true);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 3, originalSize: 20 }).success).toBe(true);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 4 }).success).toBe(false);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 2 }).success).toBe(false);
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 1, originalSize: 20 }).success).toBe(
        false
    );
    expect(SplitHeaderSchema.safeParse({ ...base, flags: 2, originalSize: 9 }).success).toBe(false);
    expect(
        SplitHeaderSchema.safeParse({ ...base, flags: 2, originalSize: 195_000_001 }).success
    ).toBe(false);
    expect(splitHeaderIsLast(SPLIT_FLAG_COMPRESSED | SPLIT_FLAG_LAST)).toBe(true);
    expect(splitHeaderIsCompressed(SPLIT_FLAG_COMPRESSED | SPLIT_FLAG_LAST)).toBe(true);
    expect(
        SplitHeaderSchema.safeParse({ ...base, flags: 0, payloadSize: 195_000_001 }).success
    ).toBe(false);
});

test('the decoder rejects unknown flag bits', () => {
    const prefix = Uint8Array.from(Buffer.from(LEGACY_ROOT_V1.prefixHex, 'hex'));
    prefix[54 + 8 + 32 + 32 + 1] = 4;

    expect(decodeSplitHeader(prefix, LEGACY_ROOT_V1.totalSize).unwrapErr().code).toBe(
        'INVALID_DOWNLOADED_BMP'
    );
});

test('new upload plans never set compression flags or originalSize', () => {
    const plan = planChunks(
        { name: 'new.bin', size: 10, fileHash: LEGACY_ROOT_V1.fileHash, folder: 'Projects' },
        fileIdentity('new.bin', LEGACY_ROOT_V1.fileHash)
    ).unwrap();

    expect(plan.headers.every((header) => header.flags === 0 || header.flags === 1)).toBe(true);
    expect(plan.headers.every((header) => header.originalSize === undefined)).toBe(true);
});

test('remote metadata keeps logical size and stored size separate', () => {
    const base = {
        fileHash: LEGACY_ROOT_V1.fileHash,
        fileId: LEGACY_ROOT_V1.fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: LEGACY_ROOT_V1.fileName,
        size: LEGACY_ROOT_V1.originalSize,
        at: 1,
        mediaKey: 'legacy-root',
        sha1: LEGACY_ROOT_V1.sha1
    };

    expect(RemoteBmpSchema.safeParse(base).success).toBe(true);
    expect(
        RemoteBmpSchema.safeParse({ ...base, storedSize: LEGACY_ROOT_V1.payloadSize }).success
    ).toBe(true);
    expect(RemoteBmpSchema.safeParse({ ...base, storedSize: base.size + 1 }).success).toBe(false);
});
