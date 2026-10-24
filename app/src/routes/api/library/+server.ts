import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { LibraryRequestSchema } from '@madkarmaa/phodrive-core/models';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, LibraryRequestSchema, 'Invalid request')
        .andThenAsync((input) => listBmps(input.email, input.token, input.pageToken ?? ''))
        .match({ Ok: jsonResponse, Err: errorResponse });
