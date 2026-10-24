import { NewAccountSchema } from '@madkarmaa/phodrive-core/models';
import { connectGoogleAccount } from '@madkarmaa/phodrive-core/server/accounts';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, NewAccountSchema, 'Invalid account')
        .andThenAsync((input) => connectGoogleAccount(input.email, input.token))
        .match({ Ok: (token) => jsonResponse({ token }), Err: errorResponse });
