<script lang="ts">
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import type { DriveManage } from '#browser/drive/manage.svelte';
    import type { MenuAction } from '#lib/menus';
    import EntryMenu from '#components/EntryMenu.svelte';
    import RenameDialog from '#components/RenameDialog.svelte';
    import MoveDialog from '#components/MoveDialog.svelte';
    import DetailsDialog from '#components/DetailsDialog.svelte';
    import DeleteFolderDialog from '#components/DeleteFolderDialog.svelte';
    import FilePreviewDialog from '#components/FilePreviewDialog.svelte';

    interface Props {
        manage: DriveManage;
        actionsDisabled: boolean;
        ondownload: (item: FileGroup) => void;
        onrestore: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        ondeleteforever: (item: FileGroup) => void;
        onopenfolder: (path: string) => void;
        onbulk: (action: MenuAction, files: readonly FileGroup[]) => void;
    }

    let {
        manage,
        actionsDisabled,
        ondownload,
        onrestore,
        ondelete,
        ondeleteforever,
        onopenfolder,
        onbulk
    }: Props = $props();

    const dialogTarget = $derived(manage.dialogTarget);
    const folderTarget = $derived(dialogTarget?.kind === 'folder' ? dialogTarget.entry : null);

    function run(action: MenuAction): void {
        const target = manage.menuTarget;
        manage.closeMenu();
        if (!target) return;
        if (target.kind === 'selection') onbulk(action, target.files);
        else if (action === 'preview' && target.kind === 'file')
            manage.openPreview(target, manage.menuTrigger);
        else if (action === 'download' && target.kind === 'file') ondownload(target.item);
        else if (action === 'rename') manage.openRename(target);
        else if (action === 'move') manage.openMove(target);
        else if (action === 'delete' && target.kind === 'file') ondelete(target.item);
        else if (action === 'restore' && target.kind === 'file') onrestore(target.item);
        else if (action === 'delete-forever' && target.kind === 'file')
            ondeleteforever(target.item);
        else if (action === 'details') manage.openDetails(target);
        else if (action === 'open' && target.kind === 'folder') onopenfolder(target.entry.path);
        else if (action === 'move-contents' && target.kind === 'folder')
            void manage.moveContents(target.entry);
        else if (action === 'delete-folder' && target.kind === 'folder')
            manage.openFolderDelete(target.entry);
    }
</script>

<EntryMenu
    open={manage.menuOpen}
    target={manage.menuTarget}
    anchor={manage.menuAnchor}
    disabled={actionsDisabled}
    onclose={() => manage.closeMenu()}
    onaction={run}
/>

<RenameDialog
    open={manage.dialog === 'rename'}
    target={dialogTarget}
    error={manage.dialogError}
    busy={manage.dialogBusy}
    onrename={(name) => {
        void manage.rename(name);
    }}
    onclose={() => manage.closeDialog()}
/>

<MoveDialog
    open={manage.dialog === 'move'}
    target={dialogTarget}
    destinations={manage.moveDestinations}
    value={manage.moveValue}
    error={manage.dialogError}
    busy={manage.dialogBusy}
    onmove={(destination) => {
        void manage.move(destination);
    }}
    onclose={() => manage.closeDialog()}
/>

<DetailsDialog
    open={manage.dialog === 'details'}
    target={dialogTarget}
    files={manage.detailFiles}
    owners={manage.detailOwners}
    onclose={() => manage.closeDialog()}
/>

<DeleteFolderDialog
    open={manage.dialog === 'delete-folder'}
    folder={folderTarget}
    count={manage.folderFileCount}
    error={manage.dialogError}
    busy={manage.dialogBusy}
    ondelete={() => {
        void manage.confirmDeleteFolder();
    }}
    onclose={() => manage.closeDialog()}
/>

<FilePreviewDialog
    open={manage.dialog === 'preview'}
    target={dialogTarget}
    token={manage.previewToken}
    showOwner={manage.showOwner}
    ondownload={(item) => {
        manage.closeDialog(false);
        ondownload(item);
    }}
    ondetails={(item) => {
        manage.closeDialog(false);
        manage.openDetails({ kind: 'file', item });
    }}
    onclose={() => {
        if (manage.dialog === 'preview') manage.closeDialog();
    }}
/>
