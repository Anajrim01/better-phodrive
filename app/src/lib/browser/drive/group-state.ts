import type { Group } from '@madkarmaa/phodrive-core/models';
import type { GroupMemberStatus } from '#browser/drive/group-pauses.svelte';

export type { GroupMemberStatus } from '#browser/drive/group-pauses.svelte';
export type GroupReadiness = 'needs-members' | 'all-paused' | 'ready';

export function groupReadiness(
    group: Group,
    statusFor: (email: string) => GroupMemberStatus
): GroupReadiness {
    if (group.accounts.length < 2) return 'needs-members';
    if (group.accounts.every((email) => statusFor(email) === 'paused')) return 'all-paused';

    return 'ready';
}
