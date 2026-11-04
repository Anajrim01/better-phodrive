import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { FileActionKind, type FileRequest, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { downloadFile, deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { bmpResponse } from '../helpers/download';
import { encodeSplitBmp } from '../helpers/split-bmp';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { asyncOk } from '../helpers/photos-mock';
import {
    fixtureBmp,
    fixtureContent,
    LEGACY_FOLDER_V2,
    LEGACY_FOLDER_V2_TAIL,
    LEGACY_ROOT_V1
} from '../fixtures/legacy-compression';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

function rootRequest(): FileRequest {
    return {
        action: FileActionKind.Download,
        email: 'test@example.com',
        token: 'aas_et/test',
        name: LEGACY_ROOT_V1.fileName,
        fileHash: LEGACY_ROOT_V1.fileHash,
        fileId: LEGACY_ROOT_V1.fileId,
        chunks: [
            {
                fileHash: LEGACY_ROOT_V1.fileHash,
                fileId: LEGACY_ROOT_V1.fileId,
                chunkIndex: 0,
                isLast: true,
                originalName: LEGACY_ROOT_V1.fileName,
                size: LEGACY_ROOT_V1.originalSize,
                storedSize: LEGACY_ROOT_V1.payloadSize,
                at: 1,
                mediaKey: 'legacy-root',
                sha1: LEGACY_ROOT_V1.sha1
            }
        ],
        workers: 1
    };
}

function folderRequest(): FileRequest {
    const chunks: RemoteBmp[] = [
        {
            fileHash: LEGACY_FOLDER_V2.fileHash,
            fileId: LEGACY_FOLDER_V2.fileId,
            chunkIndex: 0,
            isLast: false,
            originalName: LEGACY_FOLDER_V2.fileName,
            folder: LEGACY_FOLDER_V2.folder,
            size: LEGACY_FOLDER_V2.originalSize,
            storedSize: LEGACY_FOLDER_V2.payloadSize,
            at: 1,
            mediaKey: 'legacy-folder',
            sha1: LEGACY_FOLDER_V2.sha1
        },
        {
            fileHash: LEGACY_FOLDER_V2.fileHash,
            fileId: LEGACY_FOLDER_V2.fileId,
            chunkIndex: 1,
            isLast: true,
            size: LEGACY_FOLDER_V2_TAIL.payloadSize,
            at: 1,
            mediaKey: 'legacy-tail',
            sha1: LEGACY_FOLDER_V2_TAIL.sha1
        }
    ];

    return {
        action: FileActionKind.Download,
        email: 'test@example.com',
        token: 'aas_et/test',
        name: LEGACY_FOLDER_V2.fileName,
        fileHash: LEGACY_FOLDER_V2.fileHash,
        fileId: LEGACY_FOLDER_V2.fileId,
        chunks,
        workers: 1
    };
}

test('deleting a compressed chunk uses only its owner key and sha1', async () => {
    const removed: string[] = [];
    vi.mocked(moveToTrash).mockImplementation((_email, _token, sha1) => {
        removed.push(sha1);

        return asyncOk(undefined);
    });

    const result = await deleteFile({
        ...rootRequest(),
        action: FileActionKind.Delete
    });

    expect(removed).toEqual([LEGACY_ROOT_V1.sha1]);
    expect(result.unwrap().deleted[0]?.storedSize).toBe(LEGACY_ROOT_V1.payloadSize);
});

test('a compressed last chunk still completes its file group with logical size', () => {
    const bmp = fixtureBmp(LEGACY_ROOT_V1);
    const grouped = groupChunks([
        {
            email: 'test@example.com',
            fileHash: LEGACY_ROOT_V1.fileHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            isLast: true,
            originalName: LEGACY_ROOT_V1.fileName,
            size: LEGACY_ROOT_V1.originalSize,
            storedSize: LEGACY_ROOT_V1.payloadSize,
            at: 1,
            mediaKey: 'legacy-root',
            sha1: createHash('sha1').update(bmp).digest('hex')
        }
    ])[0]!;

    expect(grouped.complete).toBe(true);
    expect(grouped.chunkCount).toBe(1);
    expect(grouped.chunks.reduce((sum, chunk) => sum + chunk.size, 0)).toBe(
        LEGACY_ROOT_V1.originalSize
    );
});

test('a legacy root compressed-last chunk downloads its original bytes', async () => {
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(fixtureBmp(LEGACY_ROOT_V1), 37))
    );

    const response = (await downloadFile(rootRequest())).unwrap();
    const bytes = Buffer.from(await response.arrayBuffer());

    expect(bytes.equals(fixtureContent(LEGACY_ROOT_V1))).toBe(true);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(LEGACY_ROOT_V1.fileHash);
});

test('a foldered compressed first chunk and raw last chunk reconstruct together', async () => {
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) =>
        asyncOk(
            bmpResponse(
                mediaKey === 'legacy-folder'
                    ? fixtureBmp(LEGACY_FOLDER_V2)
                    : fixtureBmp(LEGACY_FOLDER_V2_TAIL),
                41
            )
        )
    );

    const response = (await downloadFile(folderRequest())).unwrap();
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = Buffer.concat([
        fixtureContent(LEGACY_FOLDER_V2),
        fixtureContent(LEGACY_FOLDER_V2_TAIL)
    ]);

    expect(bytes.equals(expected)).toBe(true);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(LEGACY_FOLDER_V2.fileHash);
});

test('a corrupt Brotli payload fails the reconstructed file', async () => {
    const corrupt = Buffer.from(fixtureBmp(LEGACY_ROOT_V1));
    const prefix = Buffer.from(LEGACY_ROOT_V1.prefixHex, 'hex');
    corrupt.fill(0, prefix.length + 5, prefix.length + 10);
    const request = rootRequest();
    request.chunks[0] = {
        ...request.chunks[0]!,
        sha1: createHash('sha1').update(corrupt).digest('hex')
    };
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(bmpResponse(corrupt, 37)));

    const response = (await downloadFile(request)).unwrap();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'DECOMPRESSION_FAILED' });
});

test('a truncated Brotli payload fails the reconstructed file', async () => {
    const truncated = Buffer.from(fixtureBmp(LEGACY_ROOT_V1));
    const prefixLength = Buffer.from(LEGACY_ROOT_V1.prefixHex, 'hex').length;
    truncated.fill(0, prefixLength + 20, prefixLength + LEGACY_ROOT_V1.payloadSize);
    const request = rootRequest();
    request.chunks[0] = {
        ...request.chunks[0]!,
        sha1: createHash('sha1').update(truncated).digest('hex')
    };
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(bmpResponse(truncated, 37)));

    const response = (await downloadFile(request)).unwrap();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'DECOMPRESSION_FAILED' });
});

test('a declared original size that does not match the Brotli output fails', async () => {
    const stored = Buffer.from(LEGACY_ROOT_V1.payloadHex, 'hex');
    const wrong = Buffer.from(
        encodeSplitBmp(stored, {
            fileHash: LEGACY_ROOT_V1.fileHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            flags: 3,
            payloadSize: stored.length,
            originalSize: LEGACY_ROOT_V1.originalSize + 1,
            fileName: LEGACY_ROOT_V1.fileName
        }).unwrap()
    );
    const request = rootRequest();
    request.chunks[0] = {
        ...request.chunks[0]!,
        size: LEGACY_ROOT_V1.originalSize + 1,
        sha1: createHash('sha1').update(wrong).digest('hex')
    };
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(bmpResponse(wrong, 37)));

    const response = (await downloadFile(request)).unwrap();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'DECOMPRESSION_FAILED' });
});

test('Brotli output larger than originalSize is rejected', async () => {
    const original = Buffer.alloc(4_096, 0x61);
    const compressed = brotliCompressSync(original);
    const bmp = Buffer.from(
        encodeSplitBmp(compressed, {
            fileHash: LEGACY_ROOT_V1.fileHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            flags: 3,
            payloadSize: compressed.length,
            originalSize: 1_024,
            fileName: 'bomb.bin'
        }).unwrap()
    );
    const request = rootRequest();
    request.name = 'bomb.bin';
    request.chunks[0] = {
        ...request.chunks[0]!,
        originalName: 'bomb.bin',
        size: 1_024,
        storedSize: compressed.length,
        sha1: createHash('sha1').update(bmp).digest('hex')
    };
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(bmpResponse(bmp, 37)));

    const response = (await downloadFile(request)).unwrap();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'DECOMPRESSION_FAILED' });
});

test('stored payload metadata must match the legacy BMP header', async () => {
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(fixtureBmp(LEGACY_ROOT_V1), 37))
    );
    const request = rootRequest();
    request.chunks[0] = { ...request.chunks[0]!, storedSize: LEGACY_ROOT_V1.payloadSize - 1 };

    const result = await downloadFile(request);
    expect(result.unwrapErr().code).toBe('DOWNLOAD_CHUNK_MISMATCH');
});

test('a compressed chunk without storedSize is rejected', async () => {
    const request = rootRequest();
    const { storedSize: _storedSize, ...chunk } = request.chunks[0]!;
    request.chunks[0] = chunk;

    const result = await downloadFile(request);
    expect(result.unwrapErr().code).toBe('INVALID_DOWNLOADED_BMP');
});
