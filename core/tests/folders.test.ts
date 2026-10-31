import { expect, test } from 'vitest';
import {
    childFolders,
    folderFromFile,
    folderTrail,
    groupChunks,
    normalizedFolder,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';

const EMAIL = 'test@example.com';
const FILE_HASH = 'ab'.repeat(32);
const FILE_ID = 'cd'.repeat(32);

function group(name: string, folder: string): FileGroup {
    return {
        email: EMAIL,
        fileHash: FILE_HASH,
        fileId: FILE_ID,
        name,
        folder,
        at: 0,
        chunkCount: null,
        chunks: [],
        complete: false
    };
}

test('child folders list immediate children with their direct file counts', () => {
    const files = [
        group('root.jpg', ''),
        group('alpha.txt', 'a'),
        group('beta.txt', 'a/b'),
        group('gamma.txt', 'a/b'),
        group('delta.txt', 'a/b/c'),
        group('deeper.txt', 'a/b/c/d'),
        group('boundary.txt', 'a/bc'),
        group('nested.txt', 'a/bc/deep'),
        group('zeta.txt', 'a/z')
    ];

    expect(childFolders(files, '')).toEqual([{ path: 'a', name: 'a', files: 1 }]);
    expect(childFolders(files, 'a')).toEqual([
        { path: 'a/b', name: 'b', files: 2 },
        { path: 'a/bc', name: 'bc', files: 1 },
        { path: 'a/z', name: 'z', files: 1 }
    ]);
    expect(childFolders(files, 'a/b')).toEqual([{ path: 'a/b/c', name: 'c', files: 1 }]);
    expect(childFolders(files, 'a/b/c')).toEqual([{ path: 'a/b/c/d', name: 'd', files: 1 }]);
    expect(childFolders(files, 'a/bc')).toEqual([{ path: 'a/bc/deep', name: 'deep', files: 1 }]);
    expect(childFolders(files, 'missing')).toEqual([]);
});

test('folder trails walk from the library root to the current path', () => {
    expect(folderTrail('')).toEqual([]);
    expect(folderTrail('a')).toEqual([{ name: 'a', path: 'a' }]);
    expect(folderTrail('a/b/c')).toEqual([
        { name: 'a', path: 'a' },
        { name: 'b', path: 'a/b' },
        { name: 'c', path: 'a/b/c' }
    ]);
});

test('folder names come from the file relative path and the fallback', () => {
    // Node's File has no webkitRelativePath, so the browser-only property is defined per instance.
    function relativeFile(relativePath: string): File {
        const file = new File(['payload'], 'a.jpg');
        Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });

        return file;
    }

    expect(folderFromFile(relativeFile('trip/2024/a.jpg'))).toBe('trip/2024');
    expect(folderFromFile(relativeFile('trip/a.jpg'), 'library')).toBe('library/trip');
    expect(folderFromFile(new File(['payload'], 'a.jpg'))).toBe('');
    expect(folderFromFile(new File(['payload'], 'a.jpg'), 'library')).toBe('library');
    expect(folderFromFile(relativeFile('a.jpg'), 'library')).toBe('library');
    expect(folderFromFile(relativeFile('trip/../a.jpg'))).toBe('');
    expect(folderFromFile(relativeFile('../a.jpg'))).toBe('');
    expect(folderFromFile(relativeFile('trip\\2024/a.jpg'))).toBe('');
});

test('grouping takes the folder from the first chunk and keeps the newest duplicate', () => {
    const base: Omit<UploadedChunk, 'chunkIndex' | 'isLast'> = {
        email: EMAIL,
        fileHash: FILE_HASH,
        fileId: FILE_ID,
        size: 100,
        at: 10,
        mediaKey: 'base',
        sha1: 'ab'.repeat(20)
    };

    const lateFirst = [
        { ...base, chunkIndex: 1, isLast: true },
        { ...base, chunkIndex: 0, isLast: false, originalName: 'video.mp4', folder: 'photos/2024' }
    ];
    const lateBefore = structuredClone(lateFirst);
    const lateGroups = groupChunks(lateFirst);
    expect(lateGroups).toHaveLength(1);
    expect(lateGroups[0].folder).toBe('photos/2024');
    expect(lateGroups[0].chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(lateFirst).toEqual(lateBefore);

    const duplicateFirst = [
        {
            ...base,
            chunkIndex: 0,
            isLast: true,
            originalName: 'newer.jpg',
            folder: 'photos/2024',
            at: 20,
            mediaKey: 'newer'
        },
        {
            ...base,
            chunkIndex: 0,
            isLast: true,
            originalName: 'older.jpg',
            folder: 'photos/2000',
            at: 10,
            mediaKey: 'older'
        }
    ];
    const duplicateBefore = structuredClone(duplicateFirst);
    const duplicateGroups = groupChunks(duplicateFirst);
    expect(duplicateGroups[0].folder).toBe('photos/2024');
    expect(duplicateGroups[0].name).toBe('newer.jpg');
    expect(duplicateGroups[0].at).toBe(20);
    expect(duplicateGroups[0].chunks.map((chunk) => chunk.mediaKey)).toEqual(['newer']);
    expect(duplicateFirst).toEqual(duplicateBefore);

    const [rootGroup] = groupChunks([{ ...base, chunkIndex: 0, isLast: true }]);
    expect(rootGroup.folder).toBe('');
});

test('folder paths normalize dropped values to an empty root folder', () => {
    expect(normalizedFolder('trip/2024')).toBe('trip/2024');
    expect(normalizedFolder(undefined)).toBe('');
    expect(normalizedFolder('')).toBe('');
    expect(normalizedFolder('/trip')).toBe('');
    expect(normalizedFolder('trip/../2024')).toBe('');
    expect(normalizedFolder('trip\\2024')).toBe('');
    expect(normalizedFolder('trip//2024')).toBe('');
    expect(normalizedFolder('.')).toBe('');
    expect(normalizedFolder('a'.repeat(256))).toBe('');
});
