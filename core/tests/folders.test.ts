import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
    childFolders,
    folderFromPath,
    folderTrail,
    groupChunks,
    identityInput,
    resolveUploadFolder,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { FolderPathSchema, RemoteBmpSchema, type RemoteBmp } from '@madkarmaa/phodrive-core/models';

const HASH = 'ab'.repeat(32);

test('root identity is byte-for-byte unchanged before folders', () => {
    const input = identityInput('same.txt', HASH);
    const identity = createHash('sha256').update(input).digest('hex');

    expect(input).toBe(`${HASH}\u0000same.txt\u0000195000000`);
    expect(identity).toBe('9d0f53e7243474d5e6301b823520da3e745e54566ac475e76883ad508264b539');
    expect(fileIdentity('same.txt', HASH)).toBe(identity);
});

test('folder identity differs from root and from another folder', async () => {
    const root = fileIdentity('same.txt', HASH);
    const documents = fileIdentity('same.txt', HASH, undefined, 'Documents');
    const archive = fileIdentity('same.txt', HASH, undefined, 'Archive');

    expect(documents).not.toBe(root);
    expect(archive).not.toBe(root);
    expect(documents).not.toBe(archive);
    expect((await uploadIdentity('same.txt', HASH, 'Documents')).unwrap()).toBe(documents);
});

test('folder paths validate separators, segments, and limits', () => {
    for (const path of ['Projects', 'Projects/2026', 'Photos/Trips/London']) {
        expect(FolderPathSchema.safeParse(path).success).toBe(true);
    }
    for (const path of ['', '/root', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a\rb', 'a\nb', 'a\0b']) {
        expect(FolderPathSchema.safeParse(path).success).toBe(false);
    }
    expect(FolderPathSchema.safeParse('a'.repeat(255)).success).toBe(true);
    expect(FolderPathSchema.safeParse('a'.repeat(256)).success).toBe(false);
    expect(FolderPathSchema.safeParse(`${'a'.repeat(255)}/${'b'.repeat(255)}`).success).toBe(true);
    expect(FolderPathSchema.safeParse('a'.repeat(513)).success).toBe(false);
    expect(RemoteBmpSchema.safeParse({ ...chunk(), chunkIndex: 1 }).success).toBe(true);
    expect(RemoteBmpSchema.safeParse({ ...chunk('Projects'), chunkIndex: 1 }).success).toBe(false);
});

test('directory picker paths combine with the current folder', () => {
    const directory = (path: string) => {
        const file = new File(['x'], 'x.bin');
        Object.defineProperty(file, 'webkitRelativePath', { value: path });

        return file;
    };

    expect(resolveUploadFolder(directory('Source/a.ts'), 'Work').unwrap()).toBe('Work/Source');
    expect(resolveUploadFolder(directory('Source/lib/a.ts')).unwrap()).toBe('Source/lib');
    expect(resolveUploadFolder(directory('Photos/Trips/a.jpg')).unwrap()).toBe('Photos/Trips');
    expect(resolveUploadFolder(new File(['x'], 'a.txt'), 'Projects/2026').unwrap()).toBe(
        'Projects/2026'
    );
});

test('malformed relative paths stay malformed and fail instead of becoming root', () => {
    const directory = (path: string) => {
        const file = new File(['x'], 'x.bin');
        Object.defineProperty(file, 'webkitRelativePath', { value: path });

        return file;
    };
    const paths = [
        '/a.ts',
        'Source//a.ts',
        'Source//nested/a.ts',
        'Source/./a.ts',
        'Source/../a.ts',
        'a/../b.txt'
    ];

    for (const root of ['', 'Work']) {
        for (const path of paths) {
            const resolved = resolveUploadFolder(directory(path), root);
            expect(resolved.isErr()).toBe(true);
            expect(resolved.unwrapErr()).toEqual({
                code: 'INVALID_FOLDER_PATH',
                message: 'Invalid folder path.'
            });
        }
    }
});

test('folderFromPath keeps the parent path', () => {
    expect(folderFromPath('Photos/Trips/a.jpg')).toBe('Photos/Trips');
    expect(folderFromPath('Photos\\Trips\\a.jpg')).toBe('Photos/Trips');
    expect(folderFromPath('a.jpg')).toBe('');
});

test('folder hierarchy exposes only immediate children and their counts', () => {
    const files = [
        { folder: 'Projects' },
        { folder: 'Projects/2026' },
        { folder: 'Projects/2026/src' },
        { folder: 'Photos' }
    ];

    expect(childFolders(files, '')).toEqual([
        { path: 'Photos', name: 'Photos', files: 1, subfolders: 0 },
        { path: 'Projects', name: 'Projects', files: 1, subfolders: 1 }
    ]);
    expect(childFolders(files, 'Projects')).toEqual([
        { path: 'Projects/2026', name: '2026', files: 1, subfolders: 1 }
    ]);
    expect(childFolders(files, 'Projects/2026')).toEqual([
        { path: 'Projects/2026/src', name: 'src', files: 1, subfolders: 0 }
    ]);
    expect(folderTrail('Projects/2026/src')).toEqual([
        { name: 'Projects', path: 'Projects' },
        { name: '2026', path: 'Projects/2026' },
        { name: 'src', path: 'Projects/2026/src' }
    ]);
});

function chunk(folder?: string, index = 0, name = 'a.txt'): UploadedChunk {
    return {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: index,
        isLast: true,
        originalName: index === 0 ? name : undefined,
        ...(folder ? { folder } : {}),
        size: 1,
        at: 1,
        mediaKey: 'media-key',
        sha1: 'c'.repeat(40),
        email: 'test@example.com',
        accountId: 'account-one'
    } satisfies RemoteBmp & { email: string };
}

test('grouping takes the folder from chunk zero and defaults root to an empty string', () => {
    expect(groupChunks([chunk()])[0]?.folder).toBe('');
    expect(groupChunks([chunk('Projects/2026')])[0]?.folder).toBe('Projects/2026');

    const grouped = groupChunks([chunk('Archive', 0), chunk(undefined, 1)]);
    expect(grouped[0]?.folder).toBe('Archive');
});

test('the same virtual folder merges files from two accounts while owners stay separate', () => {
    const grouped = groupChunks([
        chunk('Projects', 0, 'a.txt'),
        {
            ...chunk('Projects', 0, 'b.txt'),
            accountId: 'account-two',
            email: 'second@example.com',
            fileHash: 'd'.repeat(64),
            fileId: 'e'.repeat(64),
            mediaKey: 'media-two'
        }
    ]);

    expect(grouped).toHaveLength(2);
    expect(childFolders(grouped, '')).toEqual([
        { path: 'Projects', name: 'Projects', files: 2, subfolders: 0 }
    ]);
    expect(grouped.map((file) => file.accountId)).toEqual(['account-one', 'account-two']);
});
