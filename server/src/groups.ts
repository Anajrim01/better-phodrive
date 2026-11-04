import {
    GroupNameSchema,
    type GoogleAccountGroup,
    type GroupName
} from '@madkarmaa/phodrive-core/models';
import { and, asc, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ServerContext } from './context';
import { googleAccount, googleAccountGroup, googleAccountGroupMember } from './db/schema';
import { AUTH_ERRORS, type AuthError } from './errors';

type Store = Pick<ServerContext, 'db'>;

function groupName(value: string): Result<GroupName, AuthError> {
    const parsed = GroupNameSchema.safeParse(value);

    return parsed.success ? Ok(parsed.data) : Err(AUTH_ERRORS.GROUP_NAME_INVALID);
}

function readGroup(
    { db }: Store,
    userId: string,
    groupId: string
): AsyncResult<GoogleAccountGroup, AuthError> {
    return Ok(undefined).andThenAsync<GoogleAccountGroup, AuthError>(async () => {
        try {
            const [group] = await db
                .select({ id: googleAccountGroup.id, name: googleAccountGroup.name })
                .from(googleAccountGroup)
                .where(
                    and(eq(googleAccountGroup.userId, userId), eq(googleAccountGroup.id, groupId))
                )
                .limit(1);
            if (!group) return Err(AUTH_ERRORS.GROUP_NOT_FOUND);

            const members = await db
                .select({ id: googleAccount.id, email: googleAccount.email })
                .from(googleAccountGroupMember)
                .innerJoin(
                    googleAccount,
                    and(
                        eq(googleAccount.userId, googleAccountGroupMember.userId),
                        eq(googleAccount.id, googleAccountGroupMember.googleAccountId)
                    )
                )
                .where(
                    and(
                        eq(googleAccountGroupMember.userId, userId),
                        eq(googleAccountGroupMember.groupId, groupId)
                    )
                )
                .orderBy(asc(googleAccount.email), asc(googleAccount.id));

            return Ok({ ...group, members });
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** Groups and their members, scoped to one authenticated user. */
export function listGoogleAccountGroups(
    store: Store,
    userId: string
): AsyncResult<GoogleAccountGroup[], AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const groups = await store.db
                .select({ id: googleAccountGroup.id, name: googleAccountGroup.name })
                .from(googleAccountGroup)
                .where(eq(googleAccountGroup.userId, userId))
                .orderBy(asc(googleAccountGroup.name), asc(googleAccountGroup.id));
            const members = await store.db
                .select({
                    groupId: googleAccountGroupMember.groupId,
                    id: googleAccount.id,
                    email: googleAccount.email
                })
                .from(googleAccountGroupMember)
                .innerJoin(
                    googleAccount,
                    and(
                        eq(googleAccount.userId, googleAccountGroupMember.userId),
                        eq(googleAccount.id, googleAccountGroupMember.googleAccountId)
                    )
                )
                .where(eq(googleAccountGroupMember.userId, userId))
                .orderBy(asc(googleAccount.email), asc(googleAccount.id));
            const byGroup = new Map<string, GoogleAccountGroup['members']>();

            for (const member of members) {
                const current = byGroup.get(member.groupId);
                const entry = { id: member.id, email: member.email };
                if (current) current.push(entry);
                else byGroup.set(member.groupId, [entry]);
            }

            return Ok(groups.map((group) => ({ ...group, members: byGroup.get(group.id) ?? [] })));
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function createGoogleAccountGroup(
    store: Store,
    userId: string,
    name: string
): AsyncResult<GoogleAccountGroup, AuthError> {
    return groupName(name).andThenAsync(async (validName) => {
        try {
            const [group] = await store.db
                .insert(googleAccountGroup)
                .values({ userId, name: validName })
                .returning({ id: googleAccountGroup.id, name: googleAccountGroup.name });

            return group ? Ok({ ...group, members: [] }) : Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function renameGoogleAccountGroup(
    store: Store,
    userId: string,
    groupId: string,
    name: string
): AsyncResult<GoogleAccountGroup, AuthError> {
    return groupName(name).andThenAsync(async (validName) => {
        try {
            const [updated] = await store.db
                .update(googleAccountGroup)
                .set({ name: validName })
                .where(
                    and(eq(googleAccountGroup.userId, userId), eq(googleAccountGroup.id, groupId))
                )
                .returning({ id: googleAccountGroup.id });

            return updated
                ? await readGroup(store, userId, groupId)
                : Err(AUTH_ERRORS.GROUP_NOT_FOUND);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function deleteGoogleAccountGroup(
    store: Store,
    userId: string,
    groupId: string
): AsyncResult<boolean, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const removed = await store.db
                .delete(googleAccountGroup)
                .where(
                    and(eq(googleAccountGroup.userId, userId), eq(googleAccountGroup.id, groupId))
                )
                .returning({ id: googleAccountGroup.id });

            return Ok(removed.length > 0);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function addGoogleAccountGroupMember(
    store: Store,
    userId: string,
    groupId: string,
    accountId: string
): AsyncResult<GoogleAccountGroup, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await store.db
                .insert(googleAccountGroupMember)
                .values({ userId, groupId, googleAccountId: accountId })
                .onConflictDoNothing();

            return await readGroup(store, userId, groupId);
        } catch (error) {
            // Drizzle wraps the driver error; only a foreign-key violation means the group or
            // account is not this user's.
            const code =
                (error as { code?: string }).code ??
                (error as { cause?: { code?: string } }).cause?.code;

            return Err(
                code === '23503'
                    ? AUTH_ERRORS.GROUP_MEMBER_INVALID
                    : AUTH_ERRORS.DATABASE_UNAVAILABLE
            );
        }
    });
}

export function removeGoogleAccountGroupMember(
    store: Store,
    userId: string,
    groupId: string,
    accountId: string
): AsyncResult<GoogleAccountGroup, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await store.db
                .delete(googleAccountGroupMember)
                .where(
                    and(
                        eq(googleAccountGroupMember.userId, userId),
                        eq(googleAccountGroupMember.groupId, groupId),
                        eq(googleAccountGroupMember.googleAccountId, accountId)
                    )
                );

            return await readGroup(store, userId, groupId);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}
