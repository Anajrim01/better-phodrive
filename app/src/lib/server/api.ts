import type { ApplicationError } from '@phodrive/core/errors';
import { readJson } from '@phodrive/core/server/request';
import { schemaResult } from '@phodrive/core/validation';
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

export function errorResponse(error: { message: string }): Response {
    return Response.json({ error: error.message }, { status: 400, headers: NO_STORE_HEADERS });
}
