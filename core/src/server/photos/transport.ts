import { throttleError, type ServerError } from '../errors';
import { invalidateAuth } from './auth-cache';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Fetcher } from '../fetcher';
import {
    parseRetryAfter,
    recordServerFailure,
    recordServerSuccess,
    recordSuccess,
    recordThrottle,
    throttleWaitSeconds
} from './throttle';

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_MIN_STATUS = 500;

export function send(
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let response: Response;

        try {
            response = await fetcher(url, init);
        } catch {
            return Err({
                code: 'REQUEST_FAILED',
                message: init.signal?.aborted ? `${stage} timed out` : `${stage} failed`
            } as const);
        }
        if (response.status !== 200) {
            try {
                await response.body?.cancel();
            } catch {
                // Preserve the HTTP failure when cancelling its response body also fails.
            }

            const retryAfterSeconds =
                response.status === TOO_MANY_REQUESTS
                    ? parseRetryAfter(response.headers.get('retry-after'))
                    : undefined;

            return Err({
                code: 'REQUEST_FAILED',
                message: `${stage} failed (HTTP ${response.status})`,
                status: response.status,
                ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
            } as const);
        }

        return Ok(response);
    });
}

export function guardedSend(
    email: string,
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    const startedAt = Date.now();
    const wait = throttleWaitSeconds(email);
    if (wait !== null)
        return Ok(undefined).andThenAsync<Response, ServerError>(async () =>
            Err(throttleError(wait))
        );

    return send(fetcher, url, init, stage)
        .map((response) => {
            recordSuccess(email, startedAt);

            return response;
        })
        .mapErr((error) => {
            if (error.code !== 'REQUEST_FAILED' || error.status === undefined) return error;

            if (error.status === TOO_MANY_REQUESTS)
                return throttleError(recordThrottle(email, error.retryAfterSeconds));

            if (error.status < SERVER_ERROR_MIN_STATUS) {
                if (error.status === 401 || error.status === 403) invalidateAuth(email);
                recordServerSuccess(email);

                return error;
            }

            const pause = recordServerFailure(email);

            return pause === null ? error : throttleError(pause);
        });
}

export function readBody(response: Response, stage: string): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body = await response.arrayBuffer();

            return Ok(Buffer.from(body));
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: `${stage} failed` } as const);
        }
    });
}
