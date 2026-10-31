import type { GroupUploadMember } from '@madkarmaa/phodrive-core/browser/upload';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { Group } from '@madkarmaa/phodrive-core/models';

export type GroupTarget = {
    group: Group;
    members: GroupUploadMember[];
};

export function pausedEmails(accounts: readonly GroupAccountState[]): string[] {
    return accounts
        .filter((account) => account.status === 'paused')
        .map((account) => account.email);
}

export function accountToken(accounts: Record<string, string>, email: string): string | undefined {
    const saved = Object.keys(accounts).find(
        (account) => account.toLowerCase() === email.toLowerCase()
    );

    return saved ? accounts[saved] : undefined;
}

export function resolveGroupTarget(
    groups: readonly Group[],
    selectedId: string,
    accounts: Record<string, string>,
    isPaused: (email: string) => boolean
): GroupTarget | null {
    const group = groups.find((current) => current.id === selectedId);
    if (!group) return null;

    const members: GroupUploadMember[] = [];
    for (const email of group.accounts) {
        const saved = Object.keys(accounts).find(
            (account) => account.toLowerCase() === email.toLowerCase()
        );
        if (!saved) continue;

        members.push({ email: saved, token: accounts[saved], paused: isPaused(saved) });
    }
    if (members.length < 2) return null;

    return { group, members };
}
