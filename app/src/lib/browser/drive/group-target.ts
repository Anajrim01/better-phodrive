import type { GroupUploadMember } from '@madkarmaa/phodrive-core/browser/upload';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { Group } from '@madkarmaa/phodrive-core/models';

export type GroupTargetMember = GroupUploadMember & { pausedUntil: number };

export type GroupTarget = {
    group: Group;
    members: GroupTargetMember[];
};

export function accountToken(accounts: Record<string, string>, email: string): string | undefined {
    const saved = Object.keys(accounts).find(
        (account) => account.toLowerCase() === email.toLowerCase()
    );

    return saved ? accounts[saved] : undefined;
}

export function nextRetryAt(accounts: readonly GroupAccountState[], now = Date.now()): number {
    let wait = Number.POSITIVE_INFINITY;
    for (const account of accounts) {
        if (account.status !== 'paused' || account.retryAfterSeconds === undefined) continue;

        wait = Math.min(wait, account.retryAfterSeconds);
    }

    return Number.isFinite(wait) ? now + wait * 1_000 : 0;
}

export function resolveGroupTarget(
    groups: readonly Group[],
    selectedId: string,
    accounts: Record<string, string>,
    pausedUntil: (email: string) => number
): GroupTarget | null {
    const group = groups.find((current) => current.id === selectedId);
    if (!group) return null;

    const now = Date.now();
    const members: GroupTargetMember[] = [];
    for (const email of group.accounts) {
        const saved = Object.keys(accounts).find(
            (account) => account.toLowerCase() === email.toLowerCase()
        );
        if (!saved) continue;

        const until = pausedUntil(saved);
        members.push({
            email: saved,
            token: accounts[saved],
            paused: until > now,
            pausedUntil: until
        });
    }
    if (members.length < 2) return null;

    return { group, members };
}
