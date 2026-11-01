import { FileActionKind, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { moveFile } from '@madkarmaa/phodrive-core/browser/manage';
import {
    applyFileAction,
    resolveFileToken,
    resolveMoveToken,
    type FileActionDeps
} from '#browser/drive/file-action';
import { bulkFailureMessage, type BulkAction, type BulkFailure } from '#browser/drive/bulk-results';
import type { MoveDestination } from '#browser/drive/manage-types';
import type { DriveSelection } from '#browser/drive/selection.svelte';
import { FILE_CHANGED_MESSAGE, fileChangedSince } from '#browser/drive/file-snapshot';
import {
    bulkMoveDestinations,
    selectionSummary,
    type SelectionSummary
} from '#browser/drive/selection-files';

type BulkDeps = FileActionDeps & {
    selection: DriveSelection;
    allFiles: () => readonly FileGroup[];
    currentFiles: () => readonly FileGroup[];
    busy: () => boolean;
    loading: () => boolean;
    applyItems: (email: string, items: readonly RemoteBmp[], revision: number) => void;
    reload: (email: string, token: string) => void;
    reloadGroup: () => void;
    closeUploads: () => void;
    feedback: (message: string) => void;
};

export class DriveBulk {
    running = $state(false);
    runningAction = $state<FileActionKind | null>(null);
    progressDone = $state(0);
    progressTotal = $state(0);

    moveOpen = $state(false);
    moveFiles = $state<readonly FileGroup[]>([]);
    moveValue = $state('');
    moveError = $state('');
    moveBusy = $state(false);

    detailsOpen = $state(false);
    detailFiles = $state<readonly FileGroup[]>([]);

    constructor(private readonly deps: BulkDeps) {}

    get moveDestinations(): MoveDestination[] {
        return bulkMoveDestinations(this.deps.allFiles(), this.moveFiles);
    }

    get detailsSummary(): SelectionSummary {
        return selectionSummary(this.detailFiles);
    }

    openMove(files: readonly FileGroup[]): void {
        if (this.blocked() || files.length === 0) return;

        this.moveFiles = [...files];
        this.moveValue = '';
        this.moveError = '';
        this.moveOpen = true;
    }

    closeMove(): void {
        if (this.moveBusy) return;

        this.moveOpen = false;
        this.moveFiles = [];
        this.moveError = '';
    }

    openDetails(files: readonly FileGroup[]): void {
        if (files.length === 0) return;

        this.detailFiles = [...files];
        this.detailsOpen = true;
    }

    closeDetails(): void {
        this.detailsOpen = false;
    }

    async download(files: readonly FileGroup[]): Promise<void> {
        await this.runAction(files, FileActionKind.Download, 'download');
    }

    async delete(files: readonly FileGroup[]): Promise<void> {
        if (!this.validateSnapshot(files)) return;

        await this.runAction(files, FileActionKind.Delete, 'delete');
    }

    async restore(files: readonly FileGroup[]): Promise<void> {
        await this.runAction(files, FileActionKind.Restore, 'restore');
    }

    async deleteForever(files: readonly FileGroup[]): Promise<void> {
        if (!this.validateSnapshot(files)) return;

        await this.runAction(files, FileActionKind.DeleteForever, 'delete');
    }

    async move(destination: string): Promise<void> {
        if (this.moveBusy || this.blocked()) return;

        const files = this.moveFiles;
        if (files.length === 0) return;

        this.moveBusy = true;
        this.moveError = '';
        this.deps.feedback('');
        const failures: BulkFailure[] = [];

        for (const item of files) {
            const routed = resolveMoveToken(item, this.deps);
            if (routed.isErr()) {
                failures.push({
                    email: item.email,
                    name: item.name,
                    message: routed.unwrapErr().message
                });

                continue;
            }

            const moved = await moveFile(item.email, routed.unwrap(), item.fileId, destination);
            moved.match({
                Ok: (response) => {
                    this.deps.applyItems(item.email, response.items, response.revision);
                    if (response.failed?.length) {
                        for (const failure of response.failed)
                            failures.push({
                                email: item.email,
                                name: failure.name,
                                message: failure.message
                            });

                        return;
                    }

                    this.deps.selection.remove(fileKey(item));
                },
                Err: (error) => {
                    failures.push({ email: item.email, name: item.name, message: error.message });
                }
            });
        }

        this.moveBusy = false;
        const message = bulkFailureMessage(failures, files.length, 'move');
        if (failures.length < files.length) {
            this.reloadAfter();
            this.closeMove();
        }
        if (message) this.deps.feedback(message);
        else this.deps.feedback('');
        if (failures.length === files.length) this.moveError = message;
    }

    private async runAction(
        files: readonly FileGroup[],
        action: FileActionKind,
        verb: BulkAction
    ): Promise<void> {
        if (!this.begin(files, action)) return;

        const failures: BulkFailure[] = [];
        for (const item of files) {
            const routed = resolveFileToken(item, action, this.deps);
            if (routed.isErr()) {
                failures.push({
                    email: item.email,
                    name: item.name,
                    message: routed.unwrapErr().message
                });
                this.progressDone++;

                continue;
            }

            const applied = await applyFileAction(item, action, routed.unwrap(), this.deps);
            applied.match({
                Ok: () => this.deps.selection.remove(fileKey(item)),
                Err: (error) => {
                    failures.push({ email: item.email, name: item.name, message: error.message });
                }
            });
            this.progressDone++;
        }

        this.running = false;
        this.runningAction = null;
        if (action !== FileActionKind.Download) this.reloadAfter();
        if (failures.length === 0 && action !== FileActionKind.Download) this.deps.closeUploads();
        this.deps.feedback(bulkFailureMessage(failures, files.length, verb));
    }

    private validateSnapshot(files: readonly FileGroup[]): boolean {
        const current = this.deps.currentFiles();

        for (const item of files) {
            const now = current.find((file) => fileKey(file) === fileKey(item));
            if (fileChangedSince(item, now, item.email)) {
                this.deps.feedback(FILE_CHANGED_MESSAGE);

                return false;
            }
        }

        return true;
    }

    private begin(files: readonly FileGroup[], action: FileActionKind): boolean {
        if (files.length === 0 || this.blocked()) return false;

        this.running = true;
        this.runningAction = action;
        this.progressDone = 0;
        this.progressTotal = files.length;
        this.deps.feedback('');

        return true;
    }

    private blocked(): boolean {
        return this.running || this.moveBusy || this.deps.busy() || this.deps.loading();
    }

    private reloadAfter(): void {
        if (this.deps.groupMode()) {
            this.deps.reloadGroup();

            return;
        }

        const { email, token } = this.deps.account();
        if (email && token) this.deps.reload(email, token);
    }
}
