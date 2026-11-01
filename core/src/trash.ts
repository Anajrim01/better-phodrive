import { groupChunks, type FileGroup, type UploadedChunk } from './files';

/** Split groups into the main list and fully trashed files; partial trash stays in the main list. */
export function partitionFileGroups(items: UploadedChunk[]): {
    files: FileGroup[];
    trashed: FileGroup[];
} {
    const files: FileGroup[] = [];
    const trashed: FileGroup[] = [];

    for (const group of groupChunks(items)) {
        const all = [...group.chunks, ...group.duplicates];
        const trashedChunks = all.filter((chunk) => chunk.trashedAt !== undefined);
        if (trashedChunks.length === 0) {
            files.push(group);

            continue;
        }

        const active = all.filter((chunk) => chunk.trashedAt === undefined);
        if (active.length === 0) {
            group.trashed = true;
            group.trashedChunks = trashedChunks;
            trashed.push(group);

            continue;
        }

        const [main] = groupChunks(active);
        main.name = group.name;
        main.folder = group.folder;
        main.at = group.at;
        main.trashedChunks = trashedChunks;
        files.push(main);
    }

    return { files, trashed };
}
