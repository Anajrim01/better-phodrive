import { watch } from 'runed';
import type { DriveController } from '#browser/drive/index.svelte';
import { applyManageItems } from '#browser/drive/apply-manage';
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
        busy: () => drive.busy || drive.bulk.running,
        loading: () => drive.library.loading,
        workers: () => drive.settings.concurrentWorkers,
        feedback: (message) => {
            drive.feedbackMessage = message;
        },
        applyItems: (email, items, revision) => {
            applyManageItems(drive.library, email, items, revision);
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
