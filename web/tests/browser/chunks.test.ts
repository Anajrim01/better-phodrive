import { expect, test } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { withoutChunk } from '#browser/drive/chunks';

function chunk(accountId: string, email: string): UploadedChunk {
    return {
        email,
        accountId,
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1,
        mediaKey: 'shared-media',
        sha1: 'c'.repeat(40)
    };
}

function file(accountId: string, email: string): FileGroup {
    return {
        email,
        accountId,
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        folder: '',
        name: 'proof.bin',
        at: 1,
        chunkCount: 1,
        chunks: [chunk(accountId, email)],
        complete: true
    };
}

test('deleting a chunk removes it only from the matching Google account', () => {
    const first = chunk('account-one', 'one@example.com');
    const second = chunk('account-two', 'two@example.com');
    const removed = { mediaKey: first.mediaKey, sha1: first.sha1 };

    expect(withoutChunk([first, second], file('account-one', 'one@example.com'), removed)).toEqual([
        second
    ]);
});

test('deleting a chunk removes it from its own account', () => {
    const first = chunk('account-one', 'one@example.com');

    expect(
        withoutChunk([first], file('account-one', 'one@example.com'), {
            mediaKey: first.mediaKey,
            sha1: first.sha1
        })
    ).toEqual([]);
});
