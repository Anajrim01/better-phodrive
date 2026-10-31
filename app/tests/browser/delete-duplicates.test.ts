import { afterEach, expect, test, vi } from 'vitest';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { deleteFile } from '#browser/files';

const EMAIL = 'test@example.com';
const FILE_HASH = 'a'.repeat(64);

function chunk(mediaKey: string, sha1: string, at: number, compressed: boolean): UploadedChunk {
    const remote: RemoteBmp = {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 1,
        storedSize: 1,
        compressed,
        at,
        mediaKey,
        sha1
    };

    return { ...remote, email: EMAIL };
}

afterEach(() => vi.restoreAllMocks());

test('browser delete requests both stored copies of the same file', async () => {
    const group = groupChunks([
        chunk('raw-copy', 'a'.repeat(40), 1, false),
        chunk('compressed-copy', 'b'.repeat(40), 2, true)
    ])[0];
    let requested: RemoteBmp[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON');
        const body = JSON.parse(init.body) as { chunks: RemoteBmp[] };
        requested = body.chunks;

        return Response.json({ deleted: body.chunks });
    });
    const removed: UploadedChunk[] = [];
    const result = await deleteFile(group, 'aas_et/test', (item) => removed.push(item), 1);

    expect(result.isOk()).toBe(true);
    expect(requested).toHaveLength(2);
    expect(removed).toHaveLength(2);
});
