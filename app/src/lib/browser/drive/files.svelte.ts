import { ConfirmKind, FileActionKind } from '@madkarmaa/phodrive-core/models';
import {
    fileKey,
    type FileAction,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { deleteFile, downloadFile, saveDownloadedFile } from '#browser/files';

export type ConfirmTarget =
    { kind: ConfirmKind.Account; email: string } | { kind: ConfirmKind.File; item: FileGroup };

export type FileDeps = {
    account: () => { email: string; token: string | undefined };
    busy: () => boolean;
    loading: () => boolean;
    files: () => readonly FileGroup[];
    workers: () => number;
    feedback: (message: string) => void;
    onDeleted: (item: FileGroup, chunk: UploadedChunk) => void;
    closeUploads: () => void;
    reload: (email: string, token: string) => void;
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
        if (!target) return;

        if (target.kind === ConfirmKind.Account) {
            this.deps.removeAccount(target.email);

            return;
        }

        const item = target.item;
        const current = this.deps.files().find((file) => fileKey(file) === fileKey(item));
        if (
            item.email !== this.deps.account().email ||
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
            this.deps.feedback('The file changed. Review its current chunks before deleting.');

            return;
        }

        void this.act(current, FileActionKind.Delete);
    }

    async act(item: FileGroup, action: FileActionKind): Promise<void> {
        if (this.deps.busy() || this.action || this.deps.loading()) return;

        const { email, token } = this.deps.account();
        if (item.email !== email || !token) {
            this.deps.feedback('Select the connected account for this file before continuing.');

            return;
        }

        this.action = { fileId: item.fileId, kind: action };
        this.deps.feedback('');

        if (action === FileActionKind.Delete) {
            const deleted = await deleteFile(
                item,
                token,
                (chunk) => this.deps.onDeleted(item, chunk),
                this.deps.workers()
            );

            deleted.inspectErr((error) => {
                this.deps.feedback(error.message);
            });

            this.deps.closeUploads();
            this.action = null;
            this.deps.reload(item.email, token);

            return;
        }

        const downloaded = await downloadFile(item, token);

        downloaded
            .andThen((file) => saveDownloadedFile(file, item.name))
            .inspectErr((error) => {
                this.deps.feedback(error.message);
            });

        this.action = null;
        this.deps.reload(item.email, token);
    }
}
