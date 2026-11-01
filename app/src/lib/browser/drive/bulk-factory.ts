import type { DriveController } from '#browser/drive/index.svelte';
import { DriveBulk } from '#browser/drive/bulk.svelte';
import { applyManageItems } from '#browser/drive/apply-manage';
import { chunkHandlers } from '#browser/drive/chunk-handlers';

export function createDriveBulk(drive: DriveController): DriveBulk {
    return new DriveBulk({
        selection: drive.selection,
        account: () => drive.currentAccount,
        groupMode: () => drive.groupMode.target !== null,
        routeMembers: () => drive.groupMode.target?.members ?? [],
        workers: () => drive.settings.concurrentWorkers,
        ...chunkHandlers(drive.library),
        allFiles: () => drive.library.files,
        busy: () => drive.busy,
        loading: () => drive.library.loading,
        applyItems: (email, items, revision) => {
            applyManageItems(drive.library, email, items, revision);
        },
        reload: (email, token) => drive.reloadAccount(email, token),
        reloadGroup: () => void drive.library.load(),
        closeUploads: () => {
            drive.uploadPanelOpen = false;
        },
        feedback: (message) => {
            drive.feedbackMessage = message;
        }
    });
}
