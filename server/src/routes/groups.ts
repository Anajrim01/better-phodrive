import { GroupNameSchema } from '@madkarmaa/phodrive-core/models';
import { Hono } from 'hono';
import { z } from 'zod';
import { errorResponse, jsonResponse, readJsonRequest } from '../api';
import type { ServerContext } from '../context';
import { AUTH_ERRORS } from '../errors';
import {
    addGoogleAccountGroupMember,
    createGoogleAccountGroup,
    deleteGoogleAccountGroup,
    listGoogleAccountGroups,
    removeGoogleAccountGroupMember,
    renameGoogleAccountGroup
} from '../groups';
import { requireUser, type ApiEnv } from '../middleware';

const GroupRequestSchema = z.object({ name: GroupNameSchema });

/** Every query behind these routes scopes group mutations to the signed-in user. */
export function groupRoutes(context: ServerContext) {
    const signedIn = requireUser(context);

    return new Hono<ApiEnv>()
        .get('/', signedIn, async (c) => {
            const groups = await listGoogleAccountGroups(context, c.get('user').id);

            return groups.match({
                Ok: (items) => jsonResponse({ groups: items }),
                Err: errorResponse
            });
        })
        .post('/', signedIn, (c) =>
            readJsonRequest(c.req.raw, GroupRequestSchema, 'Enter a group name.')
                .andThenAsync(({ name }) =>
                    createGoogleAccountGroup(context, c.get('user').id, name)
                )
                .match({
                    Ok: (group) => jsonResponse({ group }),
                    Err: errorResponse
                })
        )
        .put('/:id', signedIn, (c) =>
            readJsonRequest(c.req.raw, GroupRequestSchema, 'Enter a group name.')
                .andThenAsync(({ name }) =>
                    renameGoogleAccountGroup(context, c.get('user').id, c.req.param('id'), name)
                )
                .match({
                    Ok: (group) => jsonResponse({ group }),
                    Err: errorResponse
                })
        )
        .delete('/:id', signedIn, async (c) => {
            const removed = await deleteGoogleAccountGroup(
                context,
                c.get('user').id,
                c.req.param('id')
            );

            return removed.match({
                Ok: (deleted) =>
                    deleted
                        ? jsonResponse({ removed: true })
                        : errorResponse(AUTH_ERRORS.GROUP_NOT_FOUND),
                Err: errorResponse
            });
        })
        .put('/:id/members/:accountId', signedIn, async (c) => {
            const group = await addGoogleAccountGroupMember(
                context,
                c.get('user').id,
                c.req.param('id'),
                c.req.param('accountId')
            );

            return group.match({
                Ok: (updated) => jsonResponse({ group: updated }),
                Err: errorResponse
            });
        })
        .delete('/:id/members/:accountId', signedIn, async (c) => {
            const group = await removeGoogleAccountGroupMember(
                context,
                c.get('user').id,
                c.req.param('id'),
                c.req.param('accountId')
            );

            return group.match({
                Ok: (updated) => jsonResponse({ group: updated }),
                Err: errorResponse
            });
        });
}
