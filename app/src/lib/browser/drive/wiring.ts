import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { DriveGroupMode } from '#browser/drive/group-mode';
import { accountToken, pausedEmails } from '#browser/drive/group-target';
import type { DriveGroups } from '#browser/drive/groups.svelte';

export function groupLibraryAccess(mode: DriveGroupMode, groups: DriveGroups) {
    return {
        members: () => mode.target?.members ?? null,
        onAccounts: (accounts: GroupAccountState[]) =>
            groups.setPausedEmails(pausedEmails(accounts))
    };
}

export function groupUploadAccess(mode: DriveGroupMode, groups: DriveGroups, reload: () => void) {
    return {
        group: () => (mode.target ? { members: mode.target.members } : null),
        reloadGroup: reload,
        markPaused: (email: string) => groups.markPaused(email)
    };
}

export function groupFileAccess(
    mode: DriveGroupMode,
    groups: DriveGroups,
    accounts: () => Record<string, string>,
    reload: () => void
) {
    return {
        groupMode: () => mode.target !== null,
        tokenForOwner: (email: string) => accountToken(accounts(), email),
        ownerPaused: (email: string) => mode.target !== null && groups.isPaused(email),
        reloadGroup: reload
    };
}
