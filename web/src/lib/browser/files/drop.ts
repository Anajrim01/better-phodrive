function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function withRelativePath(file: File, path: string): File {
    if (path)
        Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path });

    return file;
}

async function collectEntry(entry: FileSystemEntry, path: string, files: File[]): Promise<void> {
    if (entry.isFile) {
        files.push(withRelativePath(await fileFromEntry(entry as FileSystemFileEntry), path));

        return;
    }
    if (!entry.isDirectory) return;

    const reader = (entry as FileSystemDirectoryEntry).createReader();
    while (true) {
        const batch = await readEntries(reader);
        if (!batch.length) return;

        for (const child of batch) {
            await collectEntry(child, path ? `${path}/${child.name}` : child.name, files);
        }
    }
}

/** Read every file in a dropped set, preserving directory entries as webkitRelativePath. */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
    const entries = Array.from(transfer.items ?? [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.webkitGetAsEntry?.())
        .filter((entry): entry is FileSystemEntry => entry !== null && entry !== undefined);

    if (!entries.length) return Array.from(transfer.files);

    const files: File[] = [];
    for (const entry of entries) {
        await collectEntry(entry, entry.isDirectory ? entry.name : '', files);
    }

    return files;
}
