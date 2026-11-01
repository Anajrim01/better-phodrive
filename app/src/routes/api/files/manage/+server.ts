import { FileManageRequestSchema } from '@madkarmaa/phodrive-core/manage';
import { manageFile } from '@madkarmaa/phodrive-core/server/manage';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, FileManageRequestSchema, 'Invalid request')
        .andThenAsync((input) => manageFile(input))
        .match({ Ok: jsonResponse, Err: errorResponse });
