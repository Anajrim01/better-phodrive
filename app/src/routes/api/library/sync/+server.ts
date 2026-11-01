import { syncLibrary } from '@madkarmaa/phodrive-core/server/photos';
import { AccountRequestSchema } from '@madkarmaa/phodrive-core/models';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const LibrarySyncRequestSchema = AccountRequestSchema.extend({
    force: z.boolean().optional(),
    revision: z.int().nonnegative().optional()
});

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, LibrarySyncRequestSchema, 'Invalid request')
        .andThenAsync((input) =>
            syncLibrary(input.email, input.token, input.force ?? false, input.revision ?? 0)
        )
        .match({ Ok: jsonResponse, Err: errorResponse });
