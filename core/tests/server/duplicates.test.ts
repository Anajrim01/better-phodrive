import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { downloadFixture } from '../helpers/download';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    moveToTrash: vi.fn()
}));

beforeEach(() => {
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

test('delete removes both stored copies after a compression toggle and re-upload', async () => {
    const { input } = downloadFixture();
    const base = input.chunks[0];
    const first = {
        ...base,
        email: input.email,
        mediaKey: 'raw-copy',
        sha1: 'a'.repeat(40),
        compressed: false,
        at: 1
    };
    const second = {
        ...base,
        email: input.email,
        mediaKey: 'compressed-copy',
        sha1: 'b'.repeat(40),
        compressed: true,
        storedSize: 1,
        at: 2
    };
    const group = groupChunks([first, second])[0];

    expect(group.chunks).toHaveLength(1);
    expect(group.duplicates).toHaveLength(1);

    const result = await deleteFile({
        ...input,
        action: FileActionKind.Delete,
        chunks: [...group.chunks, ...group.duplicates]
    });

    expect(result.unwrap().deleted).toHaveLength(2);
    expect(moveToTrash).toHaveBeenCalledTimes(2);
});
