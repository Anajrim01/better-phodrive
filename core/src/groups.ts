import { Err, Ok, type Result } from 'results-ts';
import { z } from 'zod';
import type { ApplicationError } from './errors';
import type { UploadedChunk } from './files';
import { GroupSchema, type Group, type RemoteBmp } from './models';

export type GroupMember = {
    email: string;
    paused: boolean;
};

export type AssignmentFile = {
    fileId: string;
    name: string;
    size: number;
};

export type FileAssignment = {
    fileId: string;
    owner: string | null;
};

function compareText(first: string, second: string): number {
    if (first === second) return 0;

    return first < second ? -1 : 1;
}

function bySizeThenName(first: AssignmentFile, second: AssignmentFile): number {
    return (
        second.size - first.size ||
        compareText(first.name, second.name) ||
        compareText(first.fileId, second.fileId)
    );
}

/**
 * Each file goes to one member with the fewest assigned bytes, and every chunk follows its file.
 * A null owner means the file waits for capacity instead of moving to a paused member.
 * Equal loads go to the earlier member in the group.
 */
export function assignOwners(
    files: readonly AssignmentFile[],
    members: readonly GroupMember[]
): FileAssignment[] {
    const available = members.filter((member) => !member.paused);
    const load = new Map(available.map((member) => [member.email, 0]));
    const owners = new Map<number, string>();
    const ordered = files
        .map((file, index) => ({ file, index }))
        .toSorted((first, second) => bySizeThenName(first.file, second.file));

    for (const { file, index } of ordered) {
        let chosen: string | undefined;

        for (const member of available) {
            if (chosen === undefined || load.get(member.email)! < load.get(chosen)!)
                chosen = member.email;
        }
        if (chosen === undefined) continue;

        owners.set(index, chosen);
        load.set(chosen, load.get(chosen)! + file.size);
    }

    return files.map((file, index) => ({
        fileId: file.fileId,
        owner: owners.get(index) ?? null
    }));
}

export type GroupAccountStatus = 'ok' | 'paused' | 'error';

export type GroupAccountState = {
    email: string;
    status: GroupAccountStatus;
    retryAfterSeconds?: number;
    message?: string;
};

export type GroupPageError = {
    code: string;
    message: string;
    retryAfterSeconds?: number;
};

export type GroupPage = {
    email: string;
    items?: readonly RemoteBmp[];
    paused?: boolean;
    error?: GroupPageError;
    revision?: number;
};

export type GroupLibrary = {
    items: UploadedChunk[];
    accounts: GroupAccountState[];
    partial: boolean;
};

function accountState(email: string, pages: readonly GroupPage[]): GroupAccountState {
    const failed = pages.find((page) => page.error && page.error.code !== 'THROTTLED')?.error;
    if (failed) return { email, status: 'error', message: failed.message };

    const throttled = pages.find((page) => page.error?.code === 'THROTTLED')?.error;
    if (pages.some((page) => page.paused) || throttled)
        return {
            email,
            status: 'paused',
            ...(throttled && throttled.code === 'THROTTLED'
                ? { retryAfterSeconds: throttled.retryAfterSeconds, message: throttled.message }
                : {})
        };

    return { email, status: 'ok' };
}

function byNewest(first: UploadedChunk, second: UploadedChunk): number {
    return (
        second.at - first.at ||
        compareText(first.email, second.email) ||
        compareText(first.fileId, second.fileId) ||
        first.chunkIndex - second.chunkIndex ||
        compareText(first.mediaKey, second.mediaKey)
    );
}

/** A failed account must not remove another account's items. */
export function mergeGroupLibrary(pages: readonly GroupPage[]): GroupLibrary {
    const pagesByAccount = new Map<string, GroupPage[]>();
    for (const page of pages) {
        const email = page.email.toLowerCase();
        const current = pagesByAccount.get(email);
        if (current) current.push(page);
        else pagesByAccount.set(email, [page]);
    }

    const ordered = [...pagesByAccount.entries()].toSorted(([first], [second]) =>
        compareText(first, second)
    );
    const seen = new Set<string>();
    const items: UploadedChunk[] = [];

    for (const [email, accountPages] of ordered) {
        for (const page of accountPages) {
            for (const item of page.items ?? []) {
                const key = `${item.mediaKey}\u0000${item.chunkIndex}`;
                if (seen.has(key)) continue;

                seen.add(key);
                items.push({ ...item, email });
            }
        }
    }

    const accounts = ordered.map(([email, accountPages]) => accountState(email, accountPages));

    return {
        items: items.toSorted(byNewest),
        accounts,
        partial: accounts.some((account) => account.status !== 'ok')
    };
}

export type RouteMember = {
    email: string;
    token: string;
    paused: boolean;
};

export type FileRoute = {
    email: string;
    token: string;
};

function ownerMember(owner: string, members: readonly RouteMember[]): RouteMember | undefined {
    const wanted = owner.toLowerCase();

    return members.find((member) => member.email.toLowerCase() === wanted);
}

/** Routing must resolve the owner's own credentials, even while that member is paused. */
export function ownerRoute(
    owner: string,
    members: readonly RouteMember[]
): Result<RouteMember, ApplicationError> {
    const member = ownerMember(owner, members);
    if (!member)
        return Err({
            code: 'OWNER_NOT_IN_GROUP',
            message: `${owner} is not in this group. Its files stay unavailable until you add it back.`
        } as const);

    return Ok({ email: member.email, token: member.token, paused: member.paused });
}

function availableRoute(
    owner: string,
    members: readonly RouteMember[],
    action: string
): Result<FileRoute, ApplicationError> {
    return ownerRoute(owner, members).andThen((member) => {
        if (member.paused)
            return Err({
                code: 'OWNER_PAUSED',
                message: `Files owned by ${member.email} cannot ${action} while that account is paused.`
            } as const);

        return Ok({ email: member.email, token: member.token });
    });
}

export function downloadRoute(
    file: { email: string },
    members: readonly RouteMember[]
): Result<FileRoute, ApplicationError> {
    return availableRoute(file.email, members, 'download');
}

export function deleteRoute(
    file: { email: string },
    members: readonly RouteMember[]
): Result<FileRoute, ApplicationError> {
    return availableRoute(file.email, members, 'be deleted');
}

/** Stored groups may predate the field or contain entries a newer schema rejects. */
export function parseStoredGroups(value: unknown): Group[] {
    if (!Array.isArray(value)) return [];

    const groups: Group[] = [];
    const ids = new Set<string>();
    for (const entry of value) {
        const parsed = GroupSchema.safeParse(entry);
        if (!parsed.success || ids.has(parsed.data.id)) continue;

        ids.add(parsed.data.id);
        groups.push(parsed.data);
    }

    return groups;
}

export const StoredGroupsSchema = z.unknown().transform(parseStoredGroups);

export const GroupsSchema = z
    .array(GroupSchema)
    .refine((groups) => new Set(groups.map((group) => group.id)).size === groups.length, {
        error: 'Group ids must be unique.'
    });
