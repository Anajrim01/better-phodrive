import { expect, test } from 'vitest';
import {
    fileKey,
    groupChunks,
    ownerKey,
    partitionFileGroups,
    type UploadedChunk
} from '../src/files';

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        accountId: 'account-one',
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1,
        mediaKey: 'media-one',
        sha1: 'c'.repeat(40),
        ...overrides
    };
}

test('the same file id on two Google accounts produces two file groups', () => {
    const first = chunk();
    const second = chunk({
        accountId: 'account-two',
        email: 'second@example.com',
        mediaKey: 'media-two'
    });

    expect(fileKey(first)).not.toBe(fileKey(second));
    expect(groupChunks([first, second])).toHaveLength(2);
});

test('identical folder files on two accounts remain two groups', () => {
    const first = chunk({ folder: 'Projects/report.pdf' });
    const second = chunk({
        accountId: 'account-two',
        email: 'second@example.com',
        folder: 'Projects/report.pdf',
        mediaKey: 'media-two'
    });

    expect(groupChunks([first, second])).toHaveLength(2);
});

test('the stable account id wins over the mutable email', () => {
    expect(ownerKey({ email: 'owner@example.com', accountId: 'account-one' })).toBe('account-one');
    expect(ownerKey({ email: 'owner@example.com' })).toBe('owner@example.com');
    expect(
        fileKey({ email: 'owner@example.com', accountId: 'account-one', fileId: 'b'.repeat(64) })
    ).toBe(`account-one:${'b'.repeat(64)}`);
});

test('chunks from one account keep the stable account id', () => {
    const grouped = groupChunks([chunk(), chunk({ chunkIndex: 1, isLast: true })]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.accountId).toBe('account-one');
    expect(grouped[0]?.chunks).toHaveLength(2);
});

test('the same folder across accounts stays separate by owner routing', () => {
    const first = chunk({ folder: 'Projects' });
    const second = chunk({
        accountId: 'account-two',
        email: 'second@example.com',
        fileId: 'd'.repeat(64),
        mediaKey: 'media-two',
        folder: 'Projects'
    });
    const grouped = groupChunks([first, second]);

    expect(grouped.map((file) => file.folder)).toEqual(['Projects', 'Projects']);
    expect(grouped.map((file) => file.accountId)).toEqual(['account-one', 'account-two']);
    expect(fileKey(grouped[0]!)).not.toBe(fileKey(grouped[1]!));
});

test('active files stay in Files and fully trashed files move to Trash', () => {
    const active = chunk();
    const trashed = chunk({
        mediaKey: 'media-two',
        fileId: 'd'.repeat(64),
        originalName: 'old.bin',
        folder: 'Projects/2026',
        trashed: true
    });
    const { files, trash } = partitionFileGroups([active, trashed]);

    expect(files.map((file) => file.name)).toEqual(['proof.bin']);
    expect(trash.map((file) => file.name)).toEqual(['old.bin']);
    expect(trash[0]?.folder).toBe('Projects/2026');
    expect(trash[0]?.trashed).toBe(true);
});

test('partially trashed files stay in Files with their original name and folder', () => {
    const first = chunk({ chunkIndex: 0, isLast: false, trashed: true });
    const last = chunk({ chunkIndex: 1, isLast: true, mediaKey: 'media-two' });
    const { files, trash } = partitionFileGroups([first, last]);

    expect(trash).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('proof.bin');
    expect(files[0]?.complete).toBe(false);
    expect(files[0]?.chunks.map((item) => item.mediaKey)).toEqual(['media-two']);
    expect(files[0]?.trashedChunks?.map((item) => item.mediaKey)).toEqual(['media-one']);
});

test('the same file id on two accounts partitions by owner', () => {
    const active = chunk();
    const trashed = chunk({
        accountId: 'account-two',
        email: 'second@example.com',
        mediaKey: 'media-two',
        trashed: true
    });
    const { files, trash } = partitionFileGroups([active, trashed]);

    expect(files).toHaveLength(1);
    expect(trash).toHaveLength(1);
    expect(files[0]?.accountId).toBe('account-one');
    expect(trash[0]?.accountId).toBe('account-two');
});
