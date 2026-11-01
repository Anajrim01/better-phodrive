import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { EntryTarget } from '#browser/drive/menu-types';
import type { MoveDestination } from '#browser/drive/manage-types';
import { filesUnderPath, folderParent, folderPaths, isInFolder } from '#lib/folders';

export function folderFileCount(files: readonly FileGroup[], target: EntryTarget | null): number {
    if (!target || target.kind !== 'folder') return 0;

    return filesUnderPath(files, target.entry.path).length;
}

export function moveValue(target: EntryTarget | null): string {
    if (!target) return '';
    if (target.kind === 'file') return target.item.folder;

    return folderParent(target.entry.path);
}

export function ownerEmails(files: readonly FileGroup[], target: EntryTarget): string[] {
    if (target.kind === 'file') return [target.item.email];

    return [...new Set(filesUnderPath(files, target.entry.path).map((file) => file.email))].sort();
}

export function moveDestinations(
    files: readonly FileGroup[],
    target: EntryTarget | null
): MoveDestination[] {
    if (!target) return [];

    const perOwner = ownerEmails(files, target).map(
        (email) => new Set(folderPaths(files.filter((file) => file.email === email)))
    );
    const paths = perOwner.length ? [...perOwner[0]!] : [];
    for (const pathsForOwner of perOwner.slice(1))
        for (let index = paths.length - 1; index >= 0; index--)
            if (!pathsForOwner.has(paths[index]!)) paths.splice(index, 1);

    const filtered =
        target.kind === 'folder'
            ? paths.filter(
                  (path) => path !== target.entry.path && !isInFolder(path, target.entry.path)
              )
            : paths;

    return [
        { value: '', label: 'My files' },
        ...filtered.map((path) => ({ value: path, label: path }))
    ];
}

export function detailFiles(files: readonly FileGroup[], target: EntryTarget | null): FileGroup[] {
    if (!target) return [];

    return target.kind === 'file' ? [target.item] : filesUnderPath(files, target.entry.path);
}

export function detailOwners(files: readonly FileGroup[], target: EntryTarget | null): string[] {
    return [...new Set(detailFiles(files, target).map((file) => file.email))].sort();
}
