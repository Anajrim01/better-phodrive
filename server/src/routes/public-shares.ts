import { Hono } from 'hono';
import { errorResponse, jsonResponse } from '../api';
import type { ServerContext } from '../context';
import { requireSharing, type ApiEnv } from '../middleware';
import { getPublicShare, issueShareChunk } from '../shares';

export function publicShareRoutes(context: ServerContext) {
    return new Hono<ApiEnv>()
        .use(requireSharing(context))
        .get('/:token', async (c) => {
            const share = await getPublicShare(context, c.req.param('token'));

            return share.match({
                Ok: (manifest) => jsonResponse(manifest),
                Err: errorResponse
            });
        })
        .post('/:token/files/:fileId/chunks/:index', async (c) => {
            const chunk = await issueShareChunk(
                context,
                c.req.param('token'),
                c.req.param('fileId'),
                Number(c.req.param('index')),
                { signal: c.req.raw.signal }
            );

            return chunk.match({
                Ok: (session) => jsonResponse(session),
                Err: errorResponse
            });
        });
}
