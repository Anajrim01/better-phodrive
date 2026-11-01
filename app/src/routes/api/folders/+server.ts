import { FolderManageRequestSchema } from '@madkarmaa/phodrive-core/manage';
import { manageFolder } from '@madkarmaa/phodrive-core/server/folders';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FolderManageRequestSchema, 'Invalid request')
        .andThenAsync((input) => manageFolder(input))
        .match({ Ok: jsonResponse, Err: errorResponse });
