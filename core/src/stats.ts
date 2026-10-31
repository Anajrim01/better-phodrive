import { fileType, type FileGroup } from './files';

export type FileTypeStat = { type: string; files: number; bytes: number };

export type LibraryStats = {
    files: number;
    completeFiles: number;
    incompleteFiles: number;
    folders: number;
    bytes: number;
    types: FileTypeStat[];
};

/** Counts bytes already stored for partial files. */
export function libraryStats(files: readonly FileGroup[]): LibraryStats {
    const types = new Map<string, FileTypeStat>();
    const folders = new Set<string>();
    let bytes = 0;
    let completeFiles = 0;

    for (const file of files) {
        const size = file.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        bytes += size;
        if (file.complete) completeFiles++;
        if (file.folder) folders.add(file.folder);

        const type = fileType(file.name);
        const entry = types.get(type) ?? { type, files: 0, bytes: 0 };
        entry.files++;
        entry.bytes += size;
        types.set(type, entry);
    }

    return {
        files: files.length,
        completeFiles,
        incompleteFiles: files.length - completeFiles,
        folders: folders.size,
        bytes,
        types: [...types.values()].sort(
            (first, second) => second.bytes - first.bytes || first.type.localeCompare(second.type)
        )
    };
}
