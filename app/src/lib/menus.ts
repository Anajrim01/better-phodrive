import type { FileGroup, FolderEntry } from '@madkarmaa/phodrive-core/files';
import { previewModeFor } from '@madkarmaa/phodrive-core/preview';

export type MenuAction =
    | 'preview'
    | 'download'
    | 'rename'
    | 'move'
    | 'restore'
    | 'delete'
    | 'delete-forever'
    | 'details'
    | 'open'
    | 'move-contents'
    | 'delete-folder';

export type MenuEntry = {
    action: MenuAction;
    label: string;
    divider?: boolean;
};

export function canRestoreFile(item: FileGroup): boolean {
    return (
        !item.trashed &&
        item.trashedChunks.some(
            (trashed) => !item.chunks.some((active) => active.chunkIndex === trashed.chunkIndex)
        )
    );
}

export function fileMenu(item: FileGroup, trash: boolean): MenuEntry[] {
    if (trash)
        return [
            { action: 'restore', label: 'Restore' },
            { action: 'delete-forever', label: 'Delete forever' },
            { action: 'details', label: 'Details', divider: true }
        ];

    const entries: MenuEntry[] = [];
    if (item.complete && previewModeFor(item.name) !== null)
        entries.push({ action: 'preview', label: 'Preview' });
    if (item.complete) entries.push({ action: 'download', label: 'Download' });
    entries.push({ action: 'rename', label: 'Rename' });
    entries.push({ action: 'move', label: 'Move to folder' });
    if (canRestoreFile(item)) entries.push({ action: 'restore', label: 'Restore' });
    entries.push({
        action: 'delete',
        label: item.complete ? 'Delete' : 'Delete remaining chunks'
    });
    entries.push({ action: 'details', label: 'Details', divider: true });

    return entries;
}

export function folderMenu(entry: FolderEntry): MenuEntry[] {
    return [
        { action: 'open', label: 'Open' },
        { action: 'rename', label: 'Rename' },
        { action: 'move', label: 'Move folder' },
        { action: 'move-contents', label: 'Move contents to My files' },
        { action: 'delete-folder', label: 'Delete folder and files' },
        { action: 'details', label: 'Details', divider: true }
    ];
}

export function selectionMenu(trash: boolean): MenuEntry[] {
    if (trash)
        return [
            { action: 'restore', label: 'Restore' },
            { action: 'delete-forever', label: 'Delete forever' },
            { action: 'details', label: 'Details', divider: true }
        ];

    return [
        { action: 'download', label: 'Download' },
        { action: 'move', label: 'Move to folder' },
        { action: 'delete', label: 'Delete' },
        { action: 'details', label: 'Details', divider: true }
    ];
}
