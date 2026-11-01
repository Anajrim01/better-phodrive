import { expect, test } from 'vitest';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { canRestoreFile, fileMenu, folderMenu } from '#lib/menus';

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'owner@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

function labels(entries: ReturnType<typeof fileMenu>): string[] {
    return entries.map((entry) => entry.label);
}

test('a complete file menu offers download, rename, move, delete, and details once', () => {
    const entries = fileMenu(file(), false);

    expect(labels(entries)).toEqual(['Download', 'Rename', 'Move to folder', 'Delete', 'Details']);
    expect(new Set(entries.map((entry) => entry.action)).size).toBe(entries.length);
});

test('a complete image or text file gets Preview before Download', () => {
    expect(labels(fileMenu(file({ name: 'photo.png' }), false))).toEqual([
        'Preview',
        'Download',
        'Rename',
        'Move to folder',
        'Delete',
        'Details'
    ]);
    expect(labels(fileMenu(file({ name: 'notes.txt' }), false))).toEqual([
        'Preview',
        'Download',
        'Rename',
        'Move to folder',
        'Delete',
        'Details'
    ]);
});

test('unsupported and incomplete files get no Preview action', () => {
    expect(labels(fileMenu(file({ name: 'report.pdf' }), false))).not.toContain('Preview');
    expect(labels(fileMenu(file({ name: 'photo.png', complete: false }), false))).not.toContain(
        'Preview'
    );
});

test('an incomplete file hides download and names the remaining chunks', () => {
    const entries = fileMenu(
        file({
            complete: false,
            chunkCount: 2,
            chunks: [chunk({ isLast: false })],
            trashedChunks: [chunk({ chunkIndex: 1, mediaKey: 'trash-1', trashedAt: 1 })]
        }),
        false
    );

    expect(labels(entries)).toEqual([
        'Rename',
        'Move to folder',
        'Restore',
        'Delete remaining chunks',
        'Details'
    ]);
    expect(
        canRestoreFile(file({ trashedChunks: [chunk({ mediaKey: 'trash', trashedAt: 1 })] }))
    ).toBe(false);
});

test('the trash menu only offers restore, delete forever, and details', () => {
    const entries = fileMenu(file({ trashed: true }), true);

    expect(labels(entries)).toEqual(['Restore', 'Delete forever', 'Details']);
});

test('a folder menu offers open, rename, flatten, delete, and details once', () => {
    const entries = folderMenu({
        path: 'A',
        name: 'A',
        files: 2,
        subfolders: 1
    });

    expect(labels(entries)).toEqual([
        'Open',
        'Rename',
        'Move folder',
        'Move contents to My files',
        'Delete folder and files',
        'Details'
    ]);
    expect(new Set(entries.map((entry) => entry.action)).size).toBe(entries.length);
});
