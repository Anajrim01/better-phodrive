import type { DriveController } from '#browser/drive/index.svelte';
import { DriveFiles } from '#browser/drive/files.svelte';
import { chunkHandlers } from '#browser/drive/chunk-handlers';
import { groupFileAccess } from '#browser/drive/wiring';

export function createDriveFiles(drive: DriveController): DriveFiles {
    const group = groupFileAccess(drive.groupMode, () => void drive.library.load());

    return new DriveFiles({
        account: () => drive.currentAccount,
        busy: () => drive.busy,
        loading: () => drive.library.loading,
        files: () => [...drive.library.files, ...drive.library.trashFiles],
        workers: () => drive.settings.concurrentWorkers,
        feedback: (message) => {
            drive.feedbackMessage = message;
        },
        ...chunkHandlers(drive.library),
        closeUploads: () => {
            drive.uploadPanelOpen = false;
        },
        reload: (email, token) => drive.reloadAccount(email, token),
        removeAccount: (email) => drive.removeAccount(email),
        ...group
    });
}
