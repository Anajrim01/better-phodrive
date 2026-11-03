import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError } from '@madkarmaa/phodrive-core/server/errors';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

test('a pause in a later batch keeps confirmed chunks and the wait', async () => {
    const { input } = downloadFixture();
    const chunks = Array.from({ length: 501 }, (_, index) => ({
        ...input.chunks[0],
        chunkIndex: index,
        mediaKey: `chunk-${index}`,
        sha1: index.toString(16).padStart(40, '0')
    }));
    let calls = 0;

    vi.mocked(moveToTrashBatch).mockImplementation(() => {
        calls++;

        return calls === 2
            ? Ok(undefined).andThenAsync(async () => Err(throttleError(120)))
            : Ok(undefined).andThenAsync(async () => Ok(undefined));
    });

    const result = await deleteFile({
        ...input,
        action: FileActionKind.Delete,
        chunks,
        workers: 1
    });

    expect(result.unwrap().deleted).toHaveLength(500);
    expect(result.unwrap().retryAfterSeconds).toBe(120);
    expect(result.unwrap().error).toBe(
        'Google Photos is limiting requests, retrying in about 2 min'
    );
});

test('a manual delete reports try again', async () => {
    const { input } = downloadFixture();
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Err(throttleError(120)))
    );

    const result = await deleteFile(
        { ...input, action: FileActionKind.Delete, workers: 1 },
        'manual'
    );

    expect(result.unwrap().deleted).toHaveLength(0);
    expect(result.unwrap().retryAfterSeconds).toBe(120);
    expect(result.unwrap().error).toBe(
        'Google Photos is limiting requests, try again in about 2 min'
    );
});
