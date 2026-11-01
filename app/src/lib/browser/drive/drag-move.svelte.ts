import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { FILE_DRAG_TYPE } from '#browser/drive/drag-types';
import type { DriveSelection } from '#browser/drive/selection.svelte';

type DriveDrag = {
    selection: DriveSelection;
    bulk: {
        moveTo: (files: readonly FileGroup[], destination: string) => Promise<void>;
    };
};

export function createDriveDrag(
    drive: DriveDrag,
    selected: () => readonly FileGroup[],
    blocked: () => boolean
) {
    let files = $state<readonly FileGroup[]>([]);

    function start(item: FileGroup, event: DragEvent): void {
        if (blocked() || !event.dataTransfer) return;

        if (drive.selection.has(fileKey(item))) files = selected();
        else {
            drive.selection.selectOnly(fileKey(item));
            files = [item];
        }

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(FILE_DRAG_TYPE, '1');
        event.dataTransfer.setData('text/plain', files.map((file) => file.name).join('\n'));
    }

    function end(): void {
        files = [];
    }

    function moveTo(destination: string): void {
        const pending = files.filter((file) => file.folder !== destination);
        files = [];
        if (pending.length > 0) void drive.bulk.moveTo(pending, destination);
    }

    return {
        get active() {
            return files.length > 0;
        },
        start,
        end,
        moveTo
    };
}
