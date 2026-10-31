import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { readJson } from '@madkarmaa/phodrive-core/server/request';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import type { AsyncResult } from 'results-ts';
import type { z } from 'zod';

// Responses carry account data or credentials, so neither results nor errors are cached.
const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export function readJsonRequest<T>(
    request: Request,
    schema: z.ZodType<T>,
    message: string
): AsyncResult<T, ApplicationError> {
    return readJson(request).andThen((body) => schemaResult(schema, body, message));
}

export function jsonResponse(body: unknown): Response {
    return Response.json(body, { headers: NO_STORE_HEADERS });
}

export function errorResponse(error: {
    code?: string;
    message: string;
    retryAfterSeconds?: number;
}): Response {
    const body =
        error.retryAfterSeconds === undefined
            ? { error: error.message }
            : { error: error.message, retryAfterSeconds: error.retryAfterSeconds };
    const status = error.code === 'THROTTLED' ? 429 : 400;

    return Response.json(body, { status, headers: NO_STORE_HEADERS });
}
