import { createMiddleware } from 'hono/factory';
import { errorResponse } from './api';
import { requireSessionUser, type SessionUser } from './auth';
import type { ServerContext } from './context';
import { readGoogleAccount, type ServerAccount } from './google';

/** The browser selects a Google account by its stable server-side row id. */
export const GOOGLE_ACCOUNT_HEADER = 'x-phodrive-account-id';

/** The server sets the socket's client address before the API sees a request. */
export type ApiEnv = { Variables: { clientAddress: string } };

export function requireUser({ auth }: ServerContext) {
    return createMiddleware<{ Variables: { user: SessionUser } }>(async (c, next) => {
        const user = await requireSessionUser(auth, c.req.raw.headers);

        return user.match<Promise<void> | Response>({
            Ok: async (signedIn) => {
                c.set('user', signedIn);
                await next();
            },
            Err: errorResponse
        });
    });
}

/** Load one of the signed-in user's Google accounts; its token never leaves the server. */
export function requireGoogleAccount(context: ServerContext) {
    return createMiddleware<{ Variables: { user: SessionUser; account: ServerAccount } }>(
        async (c, next) => {
            const account = await readGoogleAccount(
                context,
                c.get('user').id,
                c.req.header(GOOGLE_ACCOUNT_HEADER) || undefined
            );

            return account.match<Promise<void> | Response>({
                Ok: async (connected) => {
                    c.set('account', connected);
                    await next();
                },
                Err: errorResponse
            });
        }
    );
}
