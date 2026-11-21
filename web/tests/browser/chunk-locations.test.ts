import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { expect, test } from 'vitest';
import { withUploadedChunks } from '#browser/drive/chunks';

test('a reused stored chunk keeps its edited path in the visible library and account cache', () => {
    const original = {
        accountId: 'account-a',
        email: 'a@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        sha1: 'c'.repeat(40),
        mediaKey: 'stored-chunk',
        chunkIndex: 0,
        isLast: true,
        originalName: 'original.bin',
        folder: 'Original',
        size: 1,
        at: 1
    } satisfies UploadedChunk;
    const edited = { ...original, displayName: 'renamed.bin', displayFolder: '' };
    const byAccount = new Map([[original.accountId, [edited]]]);

    expect(withUploadedChunks(byAccount, [edited], [original])).toEqual([edited]);
    expect(byAccount.get(original.accountId)).toEqual([edited]);
});
