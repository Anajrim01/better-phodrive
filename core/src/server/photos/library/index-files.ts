import type { RemoteBmp } from '../../../models';
import { isInFolder } from './overrides';

export type IndexedFile = {
    fileId: string;
    name: string;
    folder: string;
    items: RemoteBmp[];
    named: boolean;
};

function blankFile(item: RemoteBmp): IndexedFile {
    return {
        fileId: item.fileId,
        name: `File ${item.fileHash.slice(0, 12)}`,
        folder: item.folder ?? '',
        items: [],
        named: false
    };
}

export function indexFiles(items: Iterable<RemoteBmp>): IndexedFile[] {
    const files = new Map<string, IndexedFile>();
    for (const item of items) {
        const file = files.get(item.fileId) ?? blankFile(item);
        file.items.push(item);
        if (item.originalName && (item.chunkIndex === 0 || !file.named)) {
            file.name = item.originalName;
            file.named = true;
        }
        if (item.chunkIndex === 0) file.folder = item.folder ?? '';
        else if (!file.folder && item.folder) file.folder = item.folder;

        files.set(item.fileId, file);
    }

    return [...files.values()];
}

export function fileById(files: readonly IndexedFile[], fileId: string): IndexedFile | undefined {
    return files.find((file) => file.fileId === fileId);
}

export function filesInFolder(files: readonly IndexedFile[], path: string): IndexedFile[] {
    return files.filter((file) => isInFolder(file.folder, path));
}

export function folderPathExists(files: readonly IndexedFile[], path: string): boolean {
    return files.some((file) => isInFolder(file.folder, path));
}

export function nameExistsInFolder(
    files: readonly IndexedFile[],
    name: string,
    folder: string,
    exceptFileId?: string
): boolean {
    return files.some(
        (file) => file.fileId !== exceptFileId && file.folder === folder && file.name === name
    );
}

export function folderOccupied(
    files: readonly IndexedFile[],
    path: string,
    exceptFileIds: ReadonlySet<string>
): boolean {
    return files.some((file) => !exceptFileIds.has(file.fileId) && isInFolder(file.folder, path));
}

export function activeChunks(files: readonly IndexedFile[]): RemoteBmp[] {
    return files.flatMap((file) => file.items.filter((item) => item.trashedAt === undefined));
}

export function parentFolder(path: string): string {
    const separator = path.lastIndexOf('/');

    return separator < 0 ? '' : path.slice(0, separator);
}

export function folderName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}
