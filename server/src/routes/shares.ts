import { CreateShareRequestSchema } from '@madkarmaa/phodrive-core/models';
import { Hono } from 'hono';
import { errorResponse, jsonResponse, readJsonRequest } from '../api';
import type { ServerContext } from '../context';
import { requireSharing, requireUser, type ApiEnv } from '../middleware';
import { createShare, listShares, revokeShare } from '../shares';

export function shareRoutes(context: ServerContext) {
    const signedIn = requireUser(context);

    return new Hono<ApiEnv>()
        .get('/', signedIn, async (c) => {
            const shares = await listShares(context.db, c.get('user').id);

            return shares.match({
                Ok: (items) => jsonResponse({ shares: items }),
                Err: errorResponse
            });
        })
        .post('/', signedIn, requireSharing(context), (c) =>
            readJsonRequest(c.req.raw, CreateShareRequestSchema, 'Invalid share request.')
                .andThenAsync((input) =>
                    createShare(context, c.get('user').id, input, {}, c.req.raw.signal)
                )
                .match({
                    Ok: (share) => jsonResponse({ share }),
                    Err: errorResponse
                })
        )
        .post('/:id/revoke', signedIn, async (c) => {
            const revoked = await revokeShare(context, c.get('user').id, c.req.param('id'));

            return revoked.match({
                Ok: (share) => jsonResponse({ share }),
                Err: errorResponse
            });
        });
}
