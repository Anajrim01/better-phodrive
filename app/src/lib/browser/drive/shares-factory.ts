import { watch } from 'runed';
import type { DriveController } from '#browser/drive/index.svelte';
import { DriveShares } from '#browser/drive/shares.svelte';

export function createDriveShares(drive: DriveController): DriveShares {
    const shares = new DriveShares({
        account: () => ({
            email: drive.selectedEmail,
            token: drive.accounts[drive.selectedEmail] ?? ''
        }),
        busy: () => drive.busy || !!drive.fileAction || drive.bulk.running,
        loading: () => drive.library.loading
    });

    watch(
        () => drive.selectedEmail,
        () => shares.reset()
    );

    return shares;
}
