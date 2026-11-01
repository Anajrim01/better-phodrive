import { ConfirmKind, FileActionKind } from '@madkarmaa/phodrive-core/models';
import { deleteRoute, downloadRoute, type RouteMember } from '@madkarmaa/phodrive-core/groups';
import {
    fileKey,
    type FileAction,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import {
    deleteFile,
    deleteForeverFile,
    downloadFile,
    restoreFile,
    saveDownloadedFile
} from '#browser/files';

export type ConfirmTarget =
    | { kind: ConfirmKind.Account; email: string }
    | { kind: ConfirmKind.File; item: FileGroup }
    | { kind: ConfirmKind.PermanentDelete; item: FileGroup };

export type FileDeps = {
    account: () => { email: string; token: string | undefined };
    busy: () => boolean;
    loading: () => boolean;
    files: () => readonly FileGroup[];
    workers: () => number;
    feedback: (message: string) => void;
    onTrashed: (item: FileGroup, chunk: UploadedChunk) => void;
    onRestored: (item: FileGroup, chunk: UploadedChunk) => void;
    onRemoved: (item: FileGroup, chunk: UploadedChunk) => void;
    closeUploads: () => void;
    reload: (email: string, token: string) => void;
    reloadGroup: () => void;
    removeAccount: (email: string) => void;
    groupMode: () => boolean;
    routeMembers: () => readonly RouteMember[];
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
        if (!target) return;

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
        if (
            item.email !== owner ||
            !current ||
            current.name !== item.name ||
            current.chunks.length !== item.chunks.length ||
            current.chunks.some(
                (chunk) =>
                    !item.chunks.some(
                        (saved) =>
                            saved.mediaKey === chunk.mediaKey &&
                            saved.sha1 === chunk.sha1 &&
                            saved.chunkIndex === chunk.chunkIndex
                    )
            )
        ) {
            this.deps.feedback('The file changed. Review its current chunks before continuing.');

            return;
        }

        void this.act(current, action);
    }

    async act(item: FileGroup, action: FileActionKind): Promise<void> {
        if (this.deps.busy() || this.action || this.deps.loading()) return;

        const { email, token: selectedToken } = this.deps.account();
        let token: string;

        if (this.deps.groupMode()) {
            const members = this.deps.routeMembers();
            const routed =
                action === FileActionKind.Download
                    ? downloadRoute(item, members)
                    : deleteRoute(item, members);
            if (routed.isErr()) {
                this.deps.feedback(routed.unwrapErr().message);

                return;
            }
            token = routed.unwrap().token;
        } else {
            if (item.email !== email || !selectedToken) {
                this.deps.feedback('Select the connected account for this file before continuing.');

                return;
            }
            token = selectedToken;
        }

        this.action = { fileId: item.fileId, kind: action };
        this.deps.feedback('');

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
                token,
                (chunk) => this.deps.onTrashed(item, chunk),
                this.deps.workers()
            );

            deleted.inspectErr((error) => {
                this.deps.feedback(error.message);
            });

            this.finish(item, token);

            return;
        }

        if (action === FileActionKind.Restore) {
            const restored = await restoreFile(item, token, (chunk) =>
                this.deps.onRestored(item, chunk)
            );

            restored.inspectErr((error) => {
                this.deps.feedback(error.message);
            });

            this.finish(item, token);

            return;
        }

        if (action === FileActionKind.DeleteForever) {
            const removed = await deleteForeverFile(
                item,
                token,
                (chunk) => this.deps.onRemoved(item, chunk),
                this.deps.workers()
            );

            removed.inspectErr((error) => {
                this.deps.feedback(error.message);
            });

            this.finish(item, token);

            return;
        }

        const downloaded = await downloadFile(item, token);

        downloaded
            .andThen((file) => saveDownloadedFile(file, item.name))
            .inspectErr((error) => {
                this.deps.feedback(error.message);
            });

        this.action = null;
        if (this.deps.groupMode()) this.deps.reloadGroup();
        else this.deps.reload(item.email, token);
    }

    private finish(item: FileGroup, token: string): void {
        this.deps.closeUploads();
        this.action = null;
        if (this.deps.groupMode()) this.deps.reloadGroup();
        else this.deps.reload(item.email, token);
    }
}
