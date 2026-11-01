import type { EntryTarget } from '#browser/drive/menu-types';
import type { ManageDeps, Navigation } from '#browser/drive/manage-types';
import { folderName, folderParent, isInFolder, joinFolder, replacePrefix } from '#lib/folders';

export function renameNavigation(target: EntryTarget, name: string): Navigation {
    if (target.kind !== 'folder') return null;

    return {
        from: target.entry.path,
        to: joinFolder(folderParent(target.entry.path), name)
    };
}

export function moveNavigation(target: EntryTarget, destination: string): Navigation {
    if (target.kind !== 'folder') return null;

    return {
        from: target.entry.path,
        to: joinFolder(destination, folderName(target.entry.path))
    };
}

export function contentsNavigation(target: EntryTarget): Navigation {
    return target.kind === 'folder' ? { from: target.entry.path, to: '' } : null;
}

export function deleteNavigation(target: EntryTarget): Navigation {
    return target.kind === 'folder' ? { from: target.entry.path, to: '' } : null;
}

export function navigate(deps: ManageDeps, navigation: Navigation): void {
    if (!navigation) return;

    const current = deps.currentFolder();
    if (!isInFolder(current, navigation.from)) return;

    deps.openFolder(replacePrefix(current, navigation.from, navigation.to));
}
