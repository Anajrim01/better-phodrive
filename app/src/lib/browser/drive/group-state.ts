import type { Group } from '@madkarmaa/phodrive-core/models';

export type GroupReadiness = 'needs-members' | 'all-paused' | 'ready';
export type GroupMemberStatus = 'unknown' | 'ready' | 'paused';

export function groupReadiness(
    group: Group,
    statusFor: (email: string) => GroupMemberStatus
): GroupReadiness {
    if (group.accounts.length < 2) return 'needs-members';
    if (group.accounts.every((email) => statusFor(email) === 'paused')) return 'all-paused';

    return 'ready';
}
