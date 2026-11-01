import { ConfirmKind, FileActionKind } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
import type { FileActionDeps } from '#browser/drive/file-action';
import { applyFileAction, resolveFileToken } from '#browser/drive/file-action';
import { FILE_CHANGED_MESSAGE, fileChangedSince } from '#browser/drive/file-snapshot';

export type ConfirmTarget =
    | { kind: ConfirmKind.Account; email: string }
    | { kind: ConfirmKind.File; item: FileGroup }
    | { kind: ConfirmKind.PermanentDelete; item: FileGroup }
    | { kind: 'selection'; files: readonly FileGroup[]; permanent: boolean };

type FileDeps = FileActionDeps & {
    busy: () => boolean;
    loading: () => boolean;
    files: () => readonly FileGroup[];
    feedback: (message: string) => void;
    closeUploads: () => void;
    reload: (email: string, token: string) => void;
    reloadGroup: () => void;
    removeAccount: (email: string) => void;
};

export class DriveFiles {
    action = $state<FileAction | null>(null);
    confirmOpen = $state(false);
    confirmTarget = $state<ConfirmTarget | null>(null);

    constructor(private readonly deps: FileDeps) {}

    confirm(): void {
        const target = this.confirmTarget;
        this.confirmOpen = false;
        this.confirmTarget = null;
        if (!target || target.kind === 'selection') return;

        if (target.kind === ConfirmKind.Account) {
            this.deps.removeAccount(target.email);

            return;
        }

        const item = target.item;
        const action =
            target.kind === ConfirmKind.PermanentDelete
                ? FileActionKind.DeleteForever
                : FileActionKind.Delete;
        const current = this.deps.files().find((file) => fileKey(file) === fileKey(item));
        const owner = this.deps.groupMode() ? item.email : this.deps.account().email;
        if (!current || fileChangedSince(item, current, owner, action)) {
            this.deps.feedback(FILE_CHANGED_MESSAGE);

            return;
        }

        void this.act(current, action);
    }

    async act(item: FileGroup, action: FileActionKind): Promise<void> {
        if (this.deps.busy() || this.action || this.deps.loading()) return;

        const routed = resolveFileToken(item, action, this.deps);
        const token = routed.match({
            Ok: (value) => value,
            Err: (error) => {
                this.deps.feedback(error.message);

                return null;
            }
        });
        if (token === null) return;

        this.action = { email: item.email, fileId: item.fileId, kind: action };
        this.deps.feedback('');

        const applied = await applyFileAction(item, action, token, this.deps);
        applied.inspectErr((error) => {
            this.deps.feedback(error.message);
        });

        if (action === FileActionKind.Download) {
            this.action = null;
            if (this.deps.groupMode()) this.deps.reloadGroup();
            else this.deps.reload(item.email, token);

            return;
        }

        this.finish(item, token);
    }

    private finish(item: FileGroup, token: string): void {
        this.deps.closeUploads();
        this.action = null;
        if (this.deps.groupMode()) this.deps.reloadGroup();
        else this.deps.reload(item.email, token);
    }
}
