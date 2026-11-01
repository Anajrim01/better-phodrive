import { fileKey, sortFiles, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { FileSort } from '@madkarmaa/phodrive-core/models';
import type { MoveDestination } from '#browser/drive/manage-types';
import { folderPaths } from '#lib/folders';

export type SelectionSummary = {
    count: number;
    size: number;
    incomplete: number;
    owners: string[];
};

export function selectionFiles(
    trash: boolean,
    visibleFiles: readonly FileGroup[],
    trashFiles: readonly FileGroup[],
    sort: FileSort
): readonly FileGroup[] {
    return trash ? sortFiles(trashFiles, sort) : visibleFiles;
}

export function selectionScope(parts: {
    folder: string;
    searchTerm: string;
    typeFilter: string;
    modifiedDays: string;
}): string {
    return JSON.stringify([parts.folder, parts.searchTerm, parts.typeFilter, parts.modifiedDays]);
}

export function selectedFiles(files: readonly FileGroup[], keys: ReadonlySet<string>): FileGroup[] {
    return files.filter((file) => keys.has(fileKey(file)));
}

export function selectionSummary(files: readonly FileGroup[]): SelectionSummary {
    const owners = new Set<string>();
    let size = 0;
    let incomplete = 0;

    for (const file of files) {
        owners.add(file.email);
        if (!file.complete) {
            incomplete++;

            continue;
        }

        size += file.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    }

    return {
        count: files.length,
        size,
        incomplete,
        owners: [...owners].sort()
    };
}

export function bulkMoveDestinations(
    allFiles: readonly FileGroup[],
    selected: readonly FileGroup[]
): MoveDestination[] {
    const owners = [...new Set(selected.map((file) => file.email))];
    if (owners.length === 0) return [];

    const pathsForOwner = owners.map(
        (email) => new Set(folderPaths(allFiles.filter((file) => file.email === email)))
    );
    let shared = [...pathsForOwner[0]!];
    for (const paths of pathsForOwner.slice(1)) shared = shared.filter((path) => paths.has(path));

    return [
        { value: '', label: 'My files' },
        ...shared
            .toSorted((first, second) => first.localeCompare(second))
            .map((path) => ({
                value: path,
                label: path
            }))
    ];
}
