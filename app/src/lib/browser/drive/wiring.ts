import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { DriveGroupMode } from '#browser/drive/group-mode';
import type { DriveGroups } from '#browser/drive/groups.svelte';

export function groupLibraryAccess(mode: DriveGroupMode, groups: DriveGroups) {
    return {
        members: () => mode.target?.members ?? null,
        onAccounts: (accounts: GroupAccountState[]) => groups.applyAccountStates(accounts)
    };
}

export function groupUploadAccess(mode: DriveGroupMode, groups: DriveGroups, reload: () => void) {
    return {
        group: () => (mode.target ? { members: mode.target.members } : null),
        reloadGroup: reload,
        markPaused: (email: string, retryAt: number) => groups.markPaused(email, retryAt),
        observe: (email: string) => groups.observe(email)
    };
}

export function groupFileAccess(mode: DriveGroupMode, reload: () => void) {
    return {
        groupMode: () => mode.target !== null,
        routeMembers: () => mode.target?.members ?? [],
        reloadGroup: reload
    };
}
