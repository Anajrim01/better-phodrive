import type { ApplicationError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { ErrorResponseSchema } from '../models';
import { schemaResult } from '../validation';
import { parseRetryAfter } from '../server/photos/throttle';

function readJson(response: Response, fallback: string): AsyncResult<unknown, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const data: unknown = await response.json();

            return Ok(data);
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback } as const);
        }
    });
}

/** Preserve server error messages while handling transport failures at the fetch boundary. */
export function request(
    url: string,
    init: RequestInit,
    fallback: string
): AsyncResult<Response, ApplicationError> {
    return Ok(undefined).andThenAsync<Response, ApplicationError>(async () => {
        let response: Response;

        try {
            response = await fetch(url, init);
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: fallback } as const);
        }

        if (response.ok) return Ok(response);

        const body = await readJson(response, fallback);

        return body.andThen((data) => {
            const parsed = schemaResult(ErrorResponseSchema, data, fallback);
            const message = parsed.match({ Ok: (value) => value.error, Err: () => fallback });

            const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));

            return Err({
                code: 'REQUEST_FAILED',
                message,
                status: response.status,
                ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
            } as const);
        });
    });
}

export function apiJson(
    url: string,
    init: RequestInit,
    fallback: string
): AsyncResult<unknown, ApplicationError> {
    return request(url, init, fallback).andThenAsync((response) => readJson(response, fallback));
}
