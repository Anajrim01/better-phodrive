import { afterEach, expect, test, vi } from 'vitest';
import { downloadFile, restoreFile } from '@madkarmaa/phodrive-core/browser/files';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';

afterEach(() => vi.restoreAllMocks());

function chunk(index: number): UploadedChunk {
    return {
        email: 'test@example.com',
        mediaKey: `chunk-${index}`,
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        sha1: 'b'.repeat(40),
        chunkIndex: index,
        chunkCount: 3,
        isLast: false,
        originalName: index === 0 ? 'archive.zip' : undefined,
        size: 4,
        at: 1
    };
}

test('an incomplete file is rejected with the missing chunk count', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const item: FileGroup = {
        email: 'test@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'archive.zip',
        folder: '',
        at: 1,
        chunkCount: 3,
        chunks: [chunk(0), chunk(2)],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: false
    };

    const downloaded = await downloadFile(item, 'aas_et/test');

    expect(downloaded.unwrapErr()).toMatchObject({
        code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
        message: '1 of 3 chunks is missing. This file cannot be downloaded.'
    });
    expect(fetchMock).not.toHaveBeenCalled();
});

test('restoring a fully trashed file sends every trashed chunk', async () => {
    const chunks: UploadedChunk[] = [chunk(0), chunk(1)].map((item) => ({
        ...item,
        chunkCount: 2,
        isLast: item.chunkIndex === 1,
        trashedAt: 1
    }));
    const item: FileGroup = {
        email: 'test@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'archive.zip',
        folder: '',
        at: 1,
        chunkCount: 2,
        chunks,
        duplicates: [],
        trashedChunks: chunks,
        trashed: true,
        complete: true
    };
    const response = chunks.map((item) => {
        const copy = { ...item };
        delete copy.trashedAt;

        return copy;
    });
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => Response.json({ restored: response }));

    const restored = await restoreFile(item, 'aas_et/test', () => {});

    expect(restored.isOk()).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        action: string;
        chunks: unknown[];
    };
    expect(body.action).toBe('restore');
    expect(body.chunks).toHaveLength(2);
});
