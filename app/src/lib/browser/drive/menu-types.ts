import type { FileGroup, FolderEntry } from '@madkarmaa/phodrive-core/files';

export type EntryTarget =
    { kind: 'file'; item: FileGroup } | { kind: 'folder'; entry: FolderEntry };

export type SelectionTarget = {
    kind: 'selection';
    files: readonly FileGroup[];
    trash: boolean;
};

export type MenuTarget = EntryTarget | SelectionTarget;

export type MenuPoint = { x: number; y: number };
export type MenuAnchor = HTMLElement | MenuPoint;

export function isPoint(anchor: MenuAnchor): anchor is MenuPoint {
    return !('getBoundingClientRect' in anchor);
}
