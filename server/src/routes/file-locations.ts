import { FileLocationsRequestSchema } from '@madkarmaa/phodrive-core/models';
import { Hono } from 'hono';
import { errorResponse, jsonResponse, readJsonRequest } from '../api';
import type { ServerContext } from '../context';
import { saveFileLocations } from '../file-location-writes';
import { requireGoogleAccount, requireUser, type ApiEnv } from '../middleware';

export function fileLocationRoutes(context: ServerContext) {
    return new Hono<ApiEnv>().patch(
        '/',
        requireUser(context),
        requireGoogleAccount(context),
        (c) => {
            const account = c.get('account');
            const scope = {
                userId: c.get('user').id,
                googleAccountId: account.id,
                googleAccountEmail: account.email
            };

            return readJsonRequest(
                c.req.raw,
                FileLocationsRequestSchema,
                'Invalid file name or folder.'
            )
                .andThenAsync(({ files }) => saveFileLocations(context.db, scope, files))
                .match({ Ok: () => jsonResponse({ updated: true }), Err: errorResponse });
        }
    );
}
