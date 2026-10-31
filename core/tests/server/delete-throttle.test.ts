import { expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError } from '@madkarmaa/phodrive-core/server/errors';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

test('a pause during delete returns confirmed chunks and the wait', async () => {
    const { input } = downloadFixture();
    let calls = 0;

    vi.mocked(moveToTrash).mockImplementation(() => {
        calls++;

        return calls === 2
            ? Ok(undefined).andThenAsync(async () => Err(throttleError(120)))
            : Ok(undefined).andThenAsync(async () => Ok(undefined));
    });

    const result = await deleteFile({ ...input, action: FileActionKind.Delete, workers: 1 });

    expect(result.unwrap().deleted).toHaveLength(1);
    expect(result.unwrap().retryAfterSeconds).toBe(120);
    expect(result.unwrap().error).toBe(
        'Google Photos is limiting requests, retrying in about 2 min'
    );
});
