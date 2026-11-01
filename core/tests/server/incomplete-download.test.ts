import { expect, test, vi } from 'vitest';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

test('an incomplete download names the missing chunks', async () => {
    const { input } = downloadFixture();
    const counted = input.chunks.map((chunk) => ({ ...chunk, chunkCount: input.chunks.length }));

    const downloaded = await downloadFile({
        ...input,
        action: FileActionKind.Download,
        chunks: counted.slice(0, 1)
    });

    expect(downloaded.unwrapErr()).toEqual({
        ...SERVER_ERRORS.INCOMPLETE_DOWNLOAD_CHUNKS,
        message: '1 of 2 chunks is missing. This file cannot be downloaded.'
    });
    expect(downloadBmp).not.toHaveBeenCalled();
});

test('a compressed chunk without a stored size is rejected', async () => {
    const { input } = downloadFixture();
    const chunks = input.chunks.map((chunk) => ({ ...chunk, compressed: true }));

    const downloaded = await downloadFile({
        ...input,
        action: FileActionKind.Download,
        chunks
    });

    expect(downloaded.unwrapErr().code).toBe('INVALID_CHUNK_METADATA');
    expect(downloadBmp).not.toHaveBeenCalled();
});

test(
    'a huge declared chunk count does not stall the download check',
    { timeout: 2_000 },
    async () => {
        const { input } = downloadFixture();
        const chunks = [{ ...input.chunks[0], chunkCount: 1_000_000_000 }];

        const downloaded = await downloadFile({
            ...input,
            action: FileActionKind.Download,
            chunks
        });

        expect(downloaded.unwrapErr().code).toBe('INCOMPLETE_DOWNLOAD_CHUNKS');
        expect(downloadBmp).not.toHaveBeenCalled();
    }
);
