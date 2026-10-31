import type { Group } from '@madkarmaa/phodrive-core/models';

export type GroupReadiness = 'needs-members' | 'all-paused' | 'ready';

export function groupReadiness(group: Group, pausedEmails: readonly string[]): GroupReadiness {
    if (group.accounts.length < 2) return 'needs-members';

    const paused = new Set(pausedEmails.map((email) => email.toLowerCase()));
    if (group.accounts.every((email) => paused.has(email.toLowerCase()))) return 'all-paused';

    return 'ready';
}
