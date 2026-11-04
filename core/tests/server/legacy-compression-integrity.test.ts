import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { FileActionKind, type FileRequest } from '@madkarmaa/phodrive-core/models';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { bmpResponse } from '../helpers/download';
import { encodeSplitBmp } from '../helpers/split-bmp';
import { asyncOk } from '../helpers/photos-mock';
import { fixtureBmp, fixtureContent, LEGACY_ROOT_V1 } from '../fixtures/legacy-compression';

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

test('a reconstructed file whose bytes do not match the declared hash fails', async () => {
    const stored = Buffer.from(LEGACY_ROOT_V1.payloadHex, 'hex');
    const wrongHash = 'a'.repeat(64);
    const bmp = Buffer.from(
        encodeSplitBmp(stored, {
            fileHash: wrongHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            flags: 3,
            payloadSize: stored.length,
            originalSize: LEGACY_ROOT_V1.originalSize,
            fileName: LEGACY_ROOT_V1.fileName
        }).unwrap()
    );
    const request = rootRequest();
    request.fileHash = wrongHash;
    request.chunks[0] = {
        ...request.chunks[0]!,
        fileHash: wrongHash,
        sha1: createHash('sha1').update(bmp).digest('hex')
    };
    vi.mocked(downloadBmp).mockImplementation(() => asyncOk(bmpResponse(bmp, 37)));

    const response = (await downloadFile(request)).unwrap();
    await expect(response.arrayBuffer()).rejects.toMatchObject({ code: 'FILE_INTEGRITY_FAILED' });
});

test('cancelling a compressed download cancels the upstream body', async () => {
    const cancelled = vi.fn();
    vi.mocked(downloadBmp).mockImplementation(() =>
        asyncOk(bmpResponse(fixtureBmp(LEGACY_ROOT_V1), 37, { onCancel: cancelled }))
    );

    const response = (await downloadFile(rootRequest())).unwrap();
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(cancelled).toHaveBeenCalledOnce();
});

test('cancelling a compressed chunk does not open the next chunk', async () => {
    const firstContent = Buffer.from(fixtureContent(LEGACY_ROOT_V1));
    const tail = Buffer.from('legacy tail chunk\n');
    const fileHash = createHash('sha256')
        .update(Buffer.concat([firstContent, tail]))
        .digest('hex');
    const fileId = fileIdentity('mixed.bin', fileHash);
    const first = Buffer.from(
        encodeSplitBmp(Buffer.from(LEGACY_ROOT_V1.payloadHex, 'hex'), {
            fileHash,
            fileId,
            chunkIndex: 0,
            flags: 2,
            payloadSize: LEGACY_ROOT_V1.payloadSize,
            originalSize: LEGACY_ROOT_V1.originalSize,
            fileName: 'mixed.bin'
        }).unwrap()
    );
    const last = Buffer.from(
        encodeSplitBmp(tail, {
            fileHash,
            fileId,
            chunkIndex: 1,
            flags: 1,
            payloadSize: tail.length
        }).unwrap()
    );
    const nextChunk = vi.fn();
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) => {
        if (mediaKey === 'legacy-root') return asyncOk(bmpResponse(first, 37));

        nextChunk();

        return asyncOk(bmpResponse(last, 37));
    });

    const response = (
        await downloadFile({
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name: 'mixed.bin',
            fileHash,
            fileId,
            chunks: [
                {
                    fileHash,
                    fileId,
                    chunkIndex: 0,
                    isLast: false,
                    originalName: 'mixed.bin',
                    size: LEGACY_ROOT_V1.originalSize,
                    storedSize: LEGACY_ROOT_V1.payloadSize,
                    at: 1,
                    mediaKey: 'legacy-root',
                    sha1: createHash('sha1').update(first).digest('hex')
                },
                {
                    fileHash,
                    fileId,
                    chunkIndex: 1,
                    isLast: true,
                    size: tail.length,
                    at: 1,
                    mediaKey: 'legacy-tail',
                    sha1: createHash('sha1').update(last).digest('hex')
                }
            ],
            workers: 1
        })
    ).unwrap();
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(nextChunk).not.toHaveBeenCalled();
});
