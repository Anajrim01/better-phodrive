import { listBmps } from '@phodrive/core/server/photos';
import { LibraryRequestSchema } from '@phodrive/core/models';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, LibraryRequestSchema, 'Invalid request')
        .andThenAsync((input) => listBmps(input.email, input.token, input.pageToken ?? ''))
        .match({ Ok: jsonResponse, Err: errorResponse });
