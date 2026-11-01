import { afterEach, expect, test, vi } from 'vitest';
import { downloadFile } from '@madkarmaa/phodrive-core/browser/files';
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
        trashedAt: null,
        complete: false
    };

    const downloaded = await downloadFile(item, 'aas_et/test');

    expect(downloaded.unwrapErr()).toMatchObject({
        code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
        message: '1 of 3 chunks is missing. This file cannot be downloaded.'
    });
    expect(fetchMock).not.toHaveBeenCalled();
});
