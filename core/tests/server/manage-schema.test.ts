import { expect, test } from 'vitest';
import {
    FileManageRequestSchema,
    FolderManageRequestSchema,
    ManageResponseSchema
} from '@madkarmaa/phodrive-core/manage';

const EMAIL = 'manage@example.com';
const TOKEN = 'aas_et/manage';
const FILE_ID = 'a'.repeat(64);

test('file management validates the action-specific fields', () => {
    expect(
        FileManageRequestSchema.safeParse({
            action: 'rename',
            email: EMAIL,
            token: TOKEN,
            fileId: FILE_ID,
            name: 'renamed.bin'
        }).success
    ).toBe(true);
    expect(
        FileManageRequestSchema.safeParse({
            action: 'move',
            email: EMAIL,
            token: TOKEN,
            fileId: FILE_ID,
            folder: ''
        }).success
    ).toBe(true);
    expect(
        FileManageRequestSchema.safeParse({
            action: 'rename',
            email: EMAIL,
            token: TOKEN,
            fileId: FILE_ID
        }).success
    ).toBe(false);
    expect(
        FileManageRequestSchema.safeParse({
            action: 'rename',
            email: EMAIL,
            token: TOKEN,
            fileId: FILE_ID,
            name: 'bad/name.bin'
        }).success
    ).toBe(false);
    expect(
        FileManageRequestSchema.safeParse({
            action: 'move',
            email: EMAIL,
            token: TOKEN,
            fileId: FILE_ID,
            folder: 'A//B'
        }).success
    ).toBe(false);
    expect(
        FileManageRequestSchema.safeParse({
            action: 'rename',
            email: 'not-an-email',
            token: TOKEN,
            fileId: FILE_ID,
            name: 'renamed.bin'
        }).success
    ).toBe(false);
});

test('folder management validates paths, destination, and workers', () => {
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'rename',
            email: EMAIL,
            token: TOKEN,
            folder: 'A/sub',
            name: 'Renamed'
        }).success
    ).toBe(true);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'move',
            email: EMAIL,
            token: TOKEN,
            folder: 'A',
            destination: ''
        }).success
    ).toBe(true);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'move-contents',
            email: EMAIL,
            token: TOKEN,
            folder: 'A'
        }).success
    ).toBe(true);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'delete',
            email: EMAIL,
            token: TOKEN,
            folder: 'A',
            workers: 2
        }).success
    ).toBe(true);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'delete',
            email: EMAIL,
            token: TOKEN,
            folder: 'A',
            workers: 0
        }).success
    ).toBe(false);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'rename',
            email: EMAIL,
            token: TOKEN,
            folder: '../A',
            name: 'Renamed'
        }).success
    ).toBe(false);
    expect(
        FolderManageRequestSchema.safeParse({
            action: 'move',
            email: 'not-an-email',
            token: TOKEN,
            folder: 'A',
            destination: ''
        }).success
    ).toBe(false);
});

test('management responses validate affected items and partial failures', () => {
    const item = {
        fileHash: 'b'.repeat(64),
        fileId: FILE_ID,
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: 'Moved',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'c'.repeat(40)
    };

    expect(
        ManageResponseSchema.safeParse({
            items: [item],
            revision: 9,
            fileCount: 1,
            failed: [
                { fileId: FILE_ID, name: 'proof.bin', message: 'Google Photos refused the request' }
            ]
        }).success
    ).toBe(true);
    expect(
        ManageResponseSchema.safeParse({
            items: [{ ...item, folder: undefined }],
            revision: 9
        }).success
    ).toBe(true);
    expect(ManageResponseSchema.safeParse({ items: [item], revision: -1 }).success).toBe(false);
    expect(
        ManageResponseSchema.safeParse({
            items: [item],
            revision: 1,
            failed: [{ fileId: 'short', name: 'proof.bin', message: 'failed' }]
        }).success
    ).toBe(false);
});
