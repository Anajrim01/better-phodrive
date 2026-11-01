import { expect, test } from 'vitest';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import {
    filesUnderPath,
    folderCount,
    folderName,
    folderParent,
    folderPaths,
    folderSuffix,
    isInFolder,
    joinFolder,
    replacePrefix
} from '#lib/folders';

test('a folder with only files shows files', () => {
    expect(folderCount(1, 0)).toBe('1 file');
    expect(folderCount(3, 0)).toBe('3 files');
});

test('a folder with only subfolders never shows a zero file part', () => {
    expect(folderCount(0, 1)).toBe('1 subfolder');
    expect(folderCount(0, 2)).toBe('2 subfolders');
});

test('a folder with both shows files then subfolders', () => {
    expect(folderCount(1, 1)).toBe('1 file · 1 subfolder');
    expect(folderCount(4, 3)).toBe('4 files · 3 subfolders');
});

test('a folder with neither renders nothing', () => {
    expect(folderCount(0, 0)).toBe('');
});

test('folder prefix helpers preserve nested suffixes and root moves', () => {
    expect(isInFolder('A/sub', 'A')).toBe(true);
    expect(isInFolder('AB', 'A')).toBe(false);
    expect(folderSuffix('A', 'A')).toBe('');
    expect(folderSuffix('A/sub', 'A')).toBe('sub');
    expect(joinFolder('', 'A')).toBe('A');
    expect(joinFolder('B', 'A')).toBe('B/A');
    expect(replacePrefix('A/sub/file', 'A', 'B')).toBe('B/sub/file');
    expect(replacePrefix('A/sub', 'A', '')).toBe('sub');
    expect(folderParent('A/sub')).toBe('A');
    expect(folderParent('A')).toBe('');
    expect(folderName('A/sub')).toBe('sub');
});

test('folder paths include every ancestor and files filter by prefix', () => {
    const files = [
        { email: 'owner@example.com', folder: 'A/sub' },
        { email: 'owner@example.com', folder: 'B' }
    ] as FileGroup[];

    expect(folderPaths(files)).toEqual(['A', 'A/sub', 'B']);
    expect(filesUnderPath(files, 'A')).toHaveLength(1);
    expect(filesUnderPath(files, 'A/sub')).toHaveLength(1);
    expect(filesUnderPath(files, 'missing')).toHaveLength(0);
});
