import type { FolderEntry } from '@madkarmaa/phodrive-core/files';
import { FileNameSchema } from '@madkarmaa/phodrive-core/models';
import {
    deleteFolder,
    moveFile,
    moveFolder,
    moveFolderContents,
    renameFile,
    renameFolder
} from '@madkarmaa/phodrive-core/browser/manage';
import {
    isPoint,
    type EntryTarget,
    type MenuAnchor,
    type MenuTarget,
    type SelectionTarget
} from '#browser/drive/menu-types';
import type {
    ManageAction,
    ManageDeps,
    ManageDialog,
    MoveDestination
} from '#browser/drive/manage-types';
import { targetName } from '#browser/drive/manage-types';
import {
    detailFiles,
    detailOwners,
    folderFileCount,
    moveDestinations,
    moveValue
} from '#browser/drive/manage-files';
import {
    contentsNavigation,
    deleteNavigation,
    moveNavigation,
    navigate,
    renameNavigation
} from '#browser/drive/manage-navigation';
import { runManage } from '#browser/drive/manage-run';
import { previewRoute } from '#browser/drive/preview-route';

export type { ManageDialog, MoveDestination } from '#browser/drive/manage-types';

export class DriveManage {
    menuOpen = $state(false);
    menuTarget = $state<MenuTarget | null>(null);
    menuAnchor = $state<MenuAnchor | null>(null);

    dialog = $state<ManageDialog | null>(null);
    dialogTarget = $state<EntryTarget | null>(null);
    dialogError = $state('');
    dialogBusy = $state(false);
    previewToken = $state('');

    private returnFocus: HTMLElement | null = null;

    constructor(private readonly deps: ManageDeps) {}

    get busy(): boolean {
        return this.dialogBusy;
    }

    get folderFileCount(): number {
        return folderFileCount(this.deps.files(), this.dialogTarget);
    }

    get moveValue(): string {
        return moveValue(this.dialogTarget);
    }

    get moveDestinations(): MoveDestination[] {
        return moveDestinations(this.deps.files(), this.dialogTarget);
    }

    get detailFiles() {
        return detailFiles(this.deps.files(), this.dialogTarget);
    }

    get detailOwners(): string[] {
        return detailOwners(this.deps.files(), this.dialogTarget);
    }

    get menuTrigger(): HTMLElement | null {
        return this.returnFocus;
    }

    get showOwner(): boolean {
        return this.deps.groupMode();
    }

    openMenu(target: MenuTarget, anchor: MenuAnchor): void {
        if (this.deps.busy() || this.deps.loading() || this.dialogBusy) return;

        this.returnFocus = isPoint(anchor)
            ? document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null
            : anchor;
        this.menuTarget = target;
        this.menuAnchor = anchor;
        this.menuOpen = true;
    }

    openBulkMenu(target: SelectionTarget, anchor: MenuAnchor): void {
        this.openMenu(target, anchor);
    }

    closeMenu(): void {
        this.menuOpen = false;
    }

    openRename(target: EntryTarget): void {
        this.openDialog('rename', target);
    }

    openMove(target: EntryTarget): void {
        this.openDialog('move', target);
    }

    openDetails(target: EntryTarget, trigger?: HTMLElement | null): void {
        this.openDialog('details', target, trigger);
    }

    openPreview(target: EntryTarget, trigger?: HTMLElement | null): void {
        if (this.deps.busy() || this.deps.loading() || this.dialogBusy) return;
        if (target.kind !== 'file') return;

        previewRoute(target.item, this.deps).match({
            Ok: (token) => {
                this.menuOpen = false;
                this.dialog = 'preview';
                this.dialogTarget = target;
                this.dialogError = '';
                this.previewToken = token;
                this.returnFocus =
                    trigger ??
                    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
            },
            Err: (error) => this.deps.feedback(error.message)
        });
    }

    openFolderDelete(entry: FolderEntry): void {
        this.openDialog('delete-folder', { kind: 'folder', entry });
    }

    closeDialog(restoreFocus = true): void {
        if (this.dialogBusy) return;

        this.dialog = null;
        this.dialogTarget = null;
        this.dialogError = '';
        this.previewToken = '';
        const focus = this.returnFocus;
        this.returnFocus = null;
        if (!restoreFocus) return;

        queueMicrotask(() => {
            if (focus?.isConnected) focus.focus();
        });
    }

    async rename(name: string): Promise<void> {
        const target = this.dialogTarget;
        const parsed = FileNameSchema.safeParse(name);
        if (!target) return;
        if (!parsed.success) {
            this.dialogError = 'Enter a name without slashes or line breaks.';

            return;
        }
        if (parsed.data === targetName(target)) {
            this.closeDialog();

            return;
        }

        const ok = await this.run(target, (email, token) =>
            target.kind === 'file'
                ? renameFile(email, token, target.item.fileId, parsed.data)
                : renameFolder(email, token, target.entry.path, parsed.data)
        );
        if (!ok) return;

        const navigation = renameNavigation(target, parsed.data);
        this.closeDialog();
        navigate(this.deps, navigation);
    }

    async move(destination: string): Promise<void> {
        const target = this.dialogTarget;
        if (!target) return;
        if (destination === this.moveValue) {
            this.closeDialog();

            return;
        }

        const ok = await this.run(target, (email, token) =>
            target.kind === 'file'
                ? moveFile(email, token, target.item.fileId, destination)
                : moveFolder(email, token, target.entry.path, destination)
        );
        if (!ok) return;

        const navigation = moveNavigation(target, destination);
        this.closeDialog();
        navigate(this.deps, navigation);
    }

    async moveContents(entry: FolderEntry): Promise<void> {
        if (this.deps.busy() || this.deps.loading()) return;

        const target: EntryTarget = { kind: 'folder', entry };
        const ok = await this.run(target, (email, token) =>
            moveFolderContents(email, token, entry.path)
        );
        if (ok) navigate(this.deps, contentsNavigation(target));
    }

    async confirmDeleteFolder(): Promise<void> {
        const target = this.dialogTarget;
        if (!target || target.kind !== 'folder') return;

        const ok = await this.run(target, (email, token) =>
            deleteFolder(email, token, target.entry.path, this.deps.workers())
        );
        if (!ok) return;

        this.closeDialog();
        navigate(this.deps, deleteNavigation(target));
    }

    private openDialog(
        dialog: ManageDialog,
        target: EntryTarget,
        trigger?: HTMLElement | null
    ): void {
        if (this.deps.busy() || this.deps.loading() || this.dialogBusy) return;

        this.menuOpen = false;
        this.dialog = dialog;
        this.dialogTarget = target;
        this.dialogError = '';
        this.previewToken = '';
        if (trigger !== undefined) this.returnFocus = trigger;
    }

    private async run(target: EntryTarget, action: ManageAction): Promise<boolean> {
        if (this.dialogBusy || this.deps.busy() || this.deps.loading()) return false;

        this.dialogBusy = true;
        this.dialogError = '';
        const outcome = await runManage(target, this.deps, action);
        this.dialogBusy = false;
        if (outcome.ok) return true;

        if (this.dialog) this.dialogError = outcome.message;
        else this.deps.feedback(outcome.message);

        return false;
    }
}
