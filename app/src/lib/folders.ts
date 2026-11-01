import type { FileGroup } from '@madkarmaa/phodrive-core/files';

export function folderCount(files: number, subfolders: number): string {
    const parts: string[] = [];

    if (files > 0) parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
    if (subfolders > 0)
        parts.push(`${subfolders} ${subfolders === 1 ? 'subfolder' : 'subfolders'}`);

    return parts.join(' · ');
}

export function isInFolder(folder: string, path: string): boolean {
    return folder === path || folder.startsWith(`${path}/`);
}

export function folderSuffix(folder: string, path: string): string {
    return folder === path ? '' : folder.slice(path.length + 1);
}

export function joinFolder(parent: string, child: string): string {
    if (!parent) return child;
    if (!child) return parent;

    return `${parent}/${child}`;
}

export function replacePrefix(folder: string, from: string, to: string): string {
    return joinFolder(to, folderSuffix(folder, from));
}

export function folderParent(path: string): string {
    const separator = path.lastIndexOf('/');

    return separator < 0 ? '' : path.slice(0, separator);
}

export function folderName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

export function filesUnderPath(files: readonly FileGroup[], path: string): FileGroup[] {
    return files.filter((file) => isInFolder(file.folder, path));
}

export function folderPaths(files: readonly FileGroup[]): string[] {
    const paths = new Set<string>();
    for (const file of files) {
        if (!file.folder) continue;

        const segments = file.folder.split('/');
        for (let index = 1; index <= segments.length; index++)
            paths.add(segments.slice(0, index).join('/'));
    }

    return [...paths].sort((first, second) => first.localeCompare(second));
}
