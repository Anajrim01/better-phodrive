import { expect, test } from 'vitest';
import { fileType, type FileGroup, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { libraryStats } from '@madkarmaa/phodrive-core/stats';

const EMAIL = 'test@example.com';
const FILE_HASH = 'ab'.repeat(32);
const FILE_ID = 'cd'.repeat(32);

function chunk(name: string, size: number, index: number): UploadedChunk {
    return {
        email: EMAIL,
        fileHash: FILE_HASH,
        fileId: FILE_ID,
        chunkIndex: index,
        isLast: true,
        size,
        at: 0,
        mediaKey: `${name}-${index}`,
        sha1: 'ab'.repeat(20)
    };
}

function group(name: string, folder: string, complete: boolean, sizes: number[]): FileGroup {
    return {
        email: EMAIL,
        fileHash: FILE_HASH,
        fileId: FILE_ID,
        name,
        folder,
        at: 0,
        chunkCount: complete ? sizes.length : null,
        chunks: sizes.map((size, index) => chunk(name, size, index)),
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        trashedAt: null,
        complete
    };
}

test('an empty library reports zeroes and no types', () => {
    expect(libraryStats([])).toEqual({
        files: 0,
        completeFiles: 0,
        incompleteFiles: 0,
        folders: 0,
        bytes: 0,
        types: []
    });
});

test('library totals count stored bytes, completion, folders and file types', () => {
    const files = [
        group('b.MP4', 'media', true, [60, 40]),
        group('a.mp4', 'media', false, [40, 60]),
        group('clip.mov', 'other', true, [300]),
        group('notes.txt', '', true, [50]),
        group('table.csv', 'other', true, [50]),
        group('README', '', false, [10]),
        group('archive.', 'media/deep', true, [5])
    ];

    expect(fileType('b.MP4')).toBe('MP4');
    expect(fileType('README')).toBe('FILE');
    expect(fileType('archive.')).toBe('FILE');

    expect(libraryStats(files)).toEqual({
        files: 7,
        completeFiles: 5,
        incompleteFiles: 2,
        folders: 3,
        bytes: 615,
        types: [
            { type: 'MOV', files: 1, bytes: 300 },
            { type: 'MP4', files: 2, bytes: 200 },
            { type: 'CSV', files: 1, bytes: 50 },
            { type: 'TXT', files: 1, bytes: 50 },
            { type: 'FILE', files: 2, bytes: 15 }
        ]
    });
});
