import { ShareRequestSchema, type ShareRequest } from '@madkarmaa/phodrive-core/share-models';
import { createShare, revokeShare } from '@madkarmaa/phodrive-core/server/share';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { AsyncResult } from 'results-ts';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

function handle(input: ShareRequest): AsyncResult<unknown, ApplicationError | ServerError> {
    return input.action === 'create' ? createShare(input) : revokeShare(input);
}

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, ShareRequestSchema, 'Invalid share request')
        .andThenAsync(handle)
        .match({ Ok: jsonResponse, Err: errorResponse });
