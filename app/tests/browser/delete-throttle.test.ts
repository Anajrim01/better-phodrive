import { expect, test, vi, afterEach } from 'vitest';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { deleteFile } from '#browser/files';

const FILE_HASH = 'ab'.repeat(32);
const CHUNK = {
    fileHash: FILE_HASH,
    fileId: FILE_HASH,
    chunkIndex: 0,
    isLast: true,
    originalName: 'proof.bin',
    size: 5,
    at: 1,
    mediaKey: 'proof',
    sha1: '0'.repeat(40)
};

afterEach(() => vi.restoreAllMocks());

test('a paused delete reports the confirmed chunks and a manual retry', async () => {
    const group = groupChunks([{ ...CHUNK, email: 'test@example.com' }])[0];
    const removed: UploadedChunk[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({ deleted: [CHUNK], retryAfterSeconds: 120 })
    );

    const result = await deleteFile(group, 'aas_et/test', (item) => removed.push(item), 2);
    const error = result.unwrapErr();

    expect(error).toEqual({
        code: 'THROTTLED',
        message:
            'Deleted 1 of 1 chunks. Google Photos is limiting requests, try again in about 2 min',
        retryAfterSeconds: 120
    });
    expect(removed).toEqual(group.chunks);
});
