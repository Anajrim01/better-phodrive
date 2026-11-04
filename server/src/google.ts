import type { Account, GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, asc, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Database } from './db/client';
import { googleAccount } from './db/schema';
import type { Environment } from './environment';
import { AUTH_ERRORS, type AuthError } from './errors';

type Store = {
    db: Database;
    env: Pick<Environment, 'BETTER_AUTH_SECRET'>;
};

type StoredGoogleAccount = GoogleAccountSummary & { encryptedToken: string };
export type ServerAccount = Account & { id: string };

function findStoredAccount(
    { db }: Store,
    userId: string,
    accountId?: string
): AsyncResult<StoredGoogleAccount | null, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const scoped = accountId
                ? and(eq(googleAccount.userId, userId), eq(googleAccount.id, accountId))
                : eq(googleAccount.userId, userId);
            const [stored] = await db
                .select({
                    id: googleAccount.id,
                    email: googleAccount.email,
                    encryptedToken: googleAccount.encryptedToken
                })
                .from(googleAccount)
                .where(scoped)
                .orderBy(asc(googleAccount.createdAt), asc(googleAccount.id))
                .limit(1);

            return Ok(stored ?? null);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

function decryptToken({ env }: Store, encryptedToken: string): AsyncResult<string, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const token = await symmetricDecrypt({
                key: env.BETTER_AUTH_SECRET,
                data: encryptedToken
            });

            return Ok(token);
        } catch {
            return Err(AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE);
        }
    });
}

function encryptToken({ env }: Store, token: string): AsyncResult<string, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const encrypted = await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: token });

            return Ok(encrypted);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** List the user's connected Google accounts without exposing their tokens. */
export function listGoogleAccounts(
    store: Store,
    userId: string
): AsyncResult<GoogleAccountSummary[], AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const rows = await store.db
                .select({ id: googleAccount.id, email: googleAccount.email })
                .from(googleAccount)
                .where(eq(googleAccount.userId, userId))
                .orderBy(asc(googleAccount.createdAt), asc(googleAccount.id));

            return Ok(rows);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** Decrypt one of the user's Google accounts, defaulting to the oldest account. */
export function readGoogleAccount(
    store: Store,
    userId: string,
    accountId?: string
): AsyncResult<ServerAccount, AuthError> {
    return findStoredAccount(store, userId, accountId)
        .andThen((stored) =>
            stored
                ? Ok(stored)
                : Err(
                      accountId
                          ? AUTH_ERRORS.GOOGLE_ACCOUNT_NOT_FOUND
                          : AUTH_ERRORS.GOOGLE_ACCOUNT_MISSING
                  )
        )
        .andThenAsync((stored) =>
            decryptToken(store, stored.encryptedToken).map((token) => ({
                id: stored.id,
                email: stored.email,
                token
            }))
        );
}

/** Read a stored email without decrypting its token, for an in-place token replacement. */
export function readGoogleEmail(
    store: Store,
    userId: string,
    accountId?: string
): AsyncResult<string, AuthError> {
    return findStoredAccount(store, userId, accountId).andThen((stored) =>
        stored
            ? Ok(stored.email)
            : Err(
                  accountId
                      ? AUTH_ERRORS.GOOGLE_ACCOUNT_NOT_FOUND
                      : AUTH_ERRORS.GOOGLE_ACCOUNT_MISSING
              )
    );
}

/** Add an account, or refresh the token when the same Google email is already connected. */
export function saveGoogleAccount(
    store: Store,
    userId: string,
    account: Account
): AsyncResult<GoogleAccountSummary, AuthError> {
    const email = account.email.toLowerCase();

    return encryptToken(store, account.token).andThenAsync(async (encryptedToken) => {
        try {
            const [saved] = await store.db
                .insert(googleAccount)
                .values({ userId, email, encryptedToken })
                .onConflictDoUpdate({
                    target: [googleAccount.userId, googleAccount.email],
                    set: { encryptedToken, updatedAt: new Date() }
                })
                .returning({ id: googleAccount.id, email: googleAccount.email });

            return saved ? Ok(saved) : Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

/** Replace one account's token without changing its identity, metadata or group membership. */
export function updateGoogleAccountToken(
    store: Store,
    userId: string,
    accountId: string,
    token: string
): AsyncResult<GoogleAccountSummary, AuthError> {
    return encryptToken(store, token).andThenAsync<GoogleAccountSummary, AuthError>(
        async (encryptedToken) => {
            try {
                const [saved] = await store.db
                    .update(googleAccount)
                    .set({ encryptedToken, updatedAt: new Date() })
                    .where(and(eq(googleAccount.userId, userId), eq(googleAccount.id, accountId)))
                    .returning({ id: googleAccount.id, email: googleAccount.email });

                return saved ? Ok(saved) : Err(AUTH_ERRORS.GOOGLE_ACCOUNT_NOT_FOUND);
            } catch {
                return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
            }
        }
    );
}

/** Disconnect one account. Its metadata and group memberships cascade. */
export function removeGoogleAccount(
    store: Store,
    userId: string,
    accountId: string
): AsyncResult<boolean, AuthError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const removed = await store.db
                .delete(googleAccount)
                .where(and(eq(googleAccount.userId, userId), eq(googleAccount.id, accountId)))
                .returning({ id: googleAccount.id });

            return Ok(removed.length > 0);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}
