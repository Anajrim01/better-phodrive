function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
    });
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
    return entry.isFile;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
    return entry.isDirectory;
}

function withRelativePath(file: File, path: string): File {
    if (!path) return file;

    Object.defineProperty(file, 'webkitRelativePath', {
        configurable: true,
        value: path
    });

    return file;
}

async function collectEntry(entry: FileSystemEntry, path: string, files: File[]): Promise<void> {
    if (isFileEntry(entry)) {
        const file = await fileFromEntry(entry);
        files.push(withRelativePath(file, path));

        return;
    }

    if (!isDirectoryEntry(entry)) return;

    const reader = entry.createReader();

    while (true) {
        const batch = await readEntries(reader);
        if (!batch.length) return;

        for (const child of batch) {
            await collectEntry(child, path ? `${path}/${child.name}` : child.name, files);
        }
    }
}

export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
    const entries: FileSystemEntry[] = [];

    for (const item of Array.from(transfer.items ?? [])) {
        if (item.kind !== 'file') continue;

        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
    }

    if (!entries.length) return Array.from(transfer.files);

    const files: File[] = [];

    for (const entry of entries) {
        await collectEntry(entry, entry.isDirectory ? entry.name : '', files);
    }

    return files;
}
