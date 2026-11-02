import { expect, test } from 'vitest';
import { folderFromFile } from '@madkarmaa/phodrive-core/files';
import { droppedFiles } from '#browser/files/drop';

function fileEntry(name: string, file = new File([name], name)): FileSystemFileEntry {
    return {
        name,
        isFile: true,
        isDirectory: false,
        file(success: (value: File) => void) {
            success(file);
        }
    } as unknown as FileSystemFileEntry;
}

function directoryEntry(
    name: string,
    children: FileSystemEntry[],
    batchSize = Math.max(children.length, 1)
): { entry: FileSystemDirectoryEntry; reads: () => number } {
    let offset = 0;
    let reads = 0;

    const entry = {
        name,
        isFile: false,
        isDirectory: true,
        createReader() {
            return {
                readEntries(success: (entries: FileSystemEntry[]) => void) {
                    reads += 1;
                    const batch = children.slice(offset, offset + batchSize);
                    offset += batch.length;
                    success(batch);
                }
            };
        }
    } as unknown as FileSystemDirectoryEntry;

    return { entry, reads: () => reads };
}

function transfer(entries: Array<FileSystemEntry | null>, files: File[] = []): DataTransfer {
    return {
        files,
        items: entries.map((entry) => ({
            kind: 'file',
            webkitGetAsEntry: () => entry
        }))
    } as unknown as DataTransfer;
}

test('a nested folder returns every descendant with its relative path', async () => {
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg', lastModified: 1234 });
    const notes = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const nested = directoryEntry('trip', [
        fileEntry('photo.jpg', photo),
        directoryEntry('2024', [fileEntry('notes.txt', notes)]).entry
    ]);

    const files = await droppedFiles(transfer([nested.entry]));

    expect(files.map((file) => file.webkitRelativePath)).toEqual([
        'trip/photo.jpg',
        'trip/2024/notes.txt'
    ]);
    expect(files.map((file) => file.name)).toEqual(['photo.jpg', 'notes.txt']);
    expect(files[0]).toMatchObject({ type: 'image/jpeg', lastModified: 1234 });
    expect(await files[0].text()).toBe('photo');
    expect(await files[1].text()).toBe('notes');
    expect(folderFromFile(files[1], 'library')).toBe('library/trip/2024');
});

test('reads directory entries in batches until the reader returns an empty batch', async () => {
    const batch = directoryEntry(
        'batch',
        [fileEntry('one.txt'), fileEntry('two.txt'), fileEntry('three.txt')],
        2
    );

    const files = await droppedFiles(transfer([batch.entry]));

    expect(files.map((file) => file.webkitRelativePath)).toEqual([
        'batch/one.txt',
        'batch/two.txt',
        'batch/three.txt'
    ]);
    expect(batch.reads()).toBe(3);
});

test('an empty folder yields no files instead of falling back to the transfer files', async () => {
    const empty = directoryEntry('empty', []);

    const files = await droppedFiles(transfer([empty.entry], [new File(['fallback'], 'fallback')]));

    expect(files).toEqual([]);
    expect(empty.reads()).toBe(1);
});

test('loose files keep their data when entries are available', async () => {
    const loose = new File(['loose'], 'loose.txt', { type: 'text/plain', lastModified: 42 });

    const files = await droppedFiles(transfer([fileEntry('loose.txt', loose)]));

    expect(files).toEqual([loose]);
    expect(files[0]).toBe(loose);
    expect(files[0].webkitRelativePath).toBeUndefined();
    expect(await files[0].text()).toBe('loose');
});

test('falls back to the transfer files when no entries are available', async () => {
    const first = new File(['first'], 'first.txt');
    const second = new File(['second'], 'second.txt');

    const files = await droppedFiles(transfer([null, null], [first, second]));

    expect(files).toEqual([first, second]);
    expect(files[0]).toBe(first);
    expect(files[1]).toBe(second);
});
