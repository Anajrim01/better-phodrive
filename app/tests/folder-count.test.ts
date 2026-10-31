import { expect, test } from 'vitest';
import { folderCount } from '#lib/folders';

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
