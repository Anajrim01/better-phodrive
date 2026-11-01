import { AppView } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { DriveController } from '#browser/drive/index.svelte';
import type { DriveManage } from '#browser/drive/manage.svelte';
import type { MenuAnchor } from '#browser/drive/menu-types';
import { applySelectionGesture } from '#browser/drive/selection.svelte';
import { isSelectionBackground } from '#browser/drive/selection-background';
import { selectionFiles, selectedFiles, selectionScope } from '#browser/drive/selection-files';
import type { MenuAction } from '#lib/menus';

export function createSelectionView(
    drive: DriveController,
    manage: DriveManage,
    view: () => AppView
) {
    const available = $derived(
        selectionFiles(
            view() === AppView.Trash,
            drive.library.visibleFiles,
            drive.library.trashFiles,
            drive.settings.fileSort
        )
    );
    const selected = $derived(selectedFiles(available, drive.selection.selectedKeys));
    const count = $derived(selected.length);
    const scope = $derived(selectionScope(drive.library));
    const overlayOpen = $derived(
        manage.menuOpen ||
            manage.dialog !== null ||
            drive.confirmOpen ||
            drive.accountMenuOpen ||
            drive.bulk.moveOpen ||
            drive.bulk.detailsOpen
    );

    function selectFile(
        item: FileGroup,
        event: MouseEvent | KeyboardEvent,
        mode: 'toggle' | 'point' = 'point'
    ): void {
        applySelectionGesture(drive.selection, fileKey(item), event, mode, available.map(fileKey));
    }

    function selectAll(select: boolean): void {
        if (select) drive.selection.selectAll(available.map(fileKey));
        else drive.selection.clear();
    }

    function selectOnly(item: FileGroup): void {
        drive.selection.selectOnly(fileKey(item));
    }

    function replace(keys: ReadonlySet<string>): void {
        drive.selection.set(keys);
    }

    function backgroundClick(event: MouseEvent, disabled: boolean): void {
        if (view() === AppView.Settings || disabled) return;
        if (isSelectionBackground(event.target)) drive.selection.clear();
    }

    function openMenu(anchor: MenuAnchor): void {
        manage.openBulkMenu(
            { kind: 'selection', files: selected, trash: view() === AppView.Trash },
            anchor
        );
    }

    function confirm(files: readonly FileGroup[], permanent: boolean): void {
        drive.confirmTarget = { kind: 'selection', files: [...files], permanent };
        drive.confirmOpen = true;
    }

    function run(action: MenuAction, files: readonly FileGroup[]): void {
        if (action === 'download') void drive.bulk.download(files);
        else if (action === 'move') drive.bulk.openMove(files);
        else if (action === 'delete') confirm(files, false);
        else if (action === 'restore') void drive.bulk.restore(files);
        else if (action === 'delete-forever') confirm(files, true);
        else if (action === 'details') drive.bulk.openDetails(files);
    }

    return {
        get available() {
            return available;
        },
        get selected() {
            return selected;
        },
        get count() {
            return count;
        },
        get scope() {
            return scope;
        },
        get overlayOpen() {
            return overlayOpen;
        },
        get canSelectAll() {
            return view() !== AppView.Settings && available.length > 0 && !overlayOpen;
        },
        get keys() {
            return drive.selection.selectedKeys;
        },
        get trash() {
            return view() === AppView.Trash;
        },
        selectFile,
        selectAll,
        selectOnly,
        replace,
        backgroundClick,
        openMenu,
        confirm,
        run,
        clear: () => drive.selection.clear()
    };
}

export type DriveSelectionView = ReturnType<typeof createSelectionView>;
