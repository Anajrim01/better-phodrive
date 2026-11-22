import { expect, test } from 'vitest';
import { droppedFiles } from '#browser/files/drop';

type TestEntry = FileSystemEntry & {
    file?: (resolve: (file: File) => void, reject: (error: unknown) => void) => void;
    createReader?: () => FileSystemDirectoryReader;
    children?: TestEntry[];
};

function fileEntry(name: string, body = 'x'): TestEntry {
    return {
        name,
        isFile: true,
        isDirectory: false,
        file: (resolve: (file: File) => void) => resolve(new File([body], name))
    } as unknown as TestEntry;
}

function directoryEntry(name: string, children: TestEntry[]): TestEntry {
    return {
        name,
        isFile: false,
        isDirectory: true,
        children,
        createReader: () => {
            let read = false;

            return {
                readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
                    resolve(read ? [] : (children as FileSystemEntry[]));
                    read = true;
                }
            } as FileSystemDirectoryReader;
        }
    } as unknown as TestEntry;
}

function transfer(entries: TestEntry[], files: File[] = []): DataTransfer {
    return {
        items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
        files
    } as unknown as DataTransfer;
}

test('a dropped directory keeps every descendant path', async () => {
    const directory = directoryEntry('trip', [
        fileEntry('photo.jpg'),
        directoryEntry('2024', [fileEntry('notes.txt')])
    ]);

    const files = await droppedFiles(transfer([directory]));

    expect(files.map((file) => file.webkitRelativePath)).toEqual([
        'trip/photo.jpg',
        'trip/2024/notes.txt'
    ]);
});

test('loose dropped files keep their original identity and empty relative path', async () => {
    const file = new File(['loose'], 'loose.txt');
    const [dropped] = await droppedFiles(transfer([fileEntry('loose.txt')], [file]));

    expect(dropped).toBeInstanceOf(File);
    expect(dropped?.webkitRelativePath).toBeUndefined();
});

test('a transfer without entries falls back to its file list', async () => {
    const file = new File(['fallback'], 'fallback.txt');
    const [dropped] = await droppedFiles(transfer([], [file]));

    expect(dropped).toBe(file);
});
