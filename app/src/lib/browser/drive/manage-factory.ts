import { applyLibraryDelta } from '@madkarmaa/phodrive-core/browser/library';
import { watch } from 'runed';
import type { DriveController } from '#browser/drive/index.svelte';
import { nextRevision } from '#browser/drive/manage-files';
import { DriveManage } from '#browser/drive/manage.svelte';

export function createDriveManage(drive: DriveController): DriveManage {
    const manage = new DriveManage({
        account: () => ({
            email: drive.selectedEmail,
            token: drive.accounts[drive.selectedEmail]
        }),
        groupMode: () => drive.groupMode.target !== null,
        routeMembers: () => drive.groupMode.target?.members ?? [],
        files: () => drive.library.files,
        busy: () => drive.busy,
        loading: () => drive.library.loading,
        workers: () => drive.settings.concurrentWorkers,
        feedback: (message) => {
            drive.feedbackMessage = message;
        },
        applyItems: (email, items, revision) => {
            drive.library.chunks = applyLibraryDelta(drive.library.chunks, email, {
                items,
                deleted: []
            });
            const key = email.toLowerCase();
            const previous = drive.library.revisions.get(key) ?? 0;
            const next = nextRevision(previous, revision);
            if (next !== undefined) drive.library.revisions.set(key, next);
        },
        openFolder: (path) => drive.library.openFolder(path),
        currentFolder: () => drive.library.folder
    });

    watch(
        () => drive.selectedEmail,
        () => {
            manage.closeMenu();
            manage.closeDialog();
        }
    );

    return manage;
}
