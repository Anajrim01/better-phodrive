import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { Fetcher } from '../fetcher';
import { parseRetryAfter, throttleError, waitForThrottle, type ThrottleScope } from './throttle';

const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR_MIN_STATUS = 500;

export function send(
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync<Response, ServerError>(async () => {
        let response: Response;

        try {
            response = await fetcher(url, init);
        } catch {
            if (init.signal?.aborted) return Err(SERVER_ERRORS.UPLOAD_CANCELLED);

            return Err({
                code: 'REQUEST_FAILED',
                message: `${stage} failed`,
                stage
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
                stage,
                status: response.status,
                ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
            } as const);
        }

        return Ok(response);
    });
}

export function guardedSend(
    scope: ThrottleScope,
    fetcher: Fetcher,
    url: string | URL,
    init: RequestInit,
    stage: string,
    options: { preserveServerFailure?: boolean } = {}
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        if (!(await waitForThrottle(scope, init.signal ?? undefined)))
            return Err(SERVER_ERRORS.UPLOAD_CANCELLED);

        const startedAt = Date.now();
        const sent = await send(fetcher, url, init, stage);
        if (sent.isOk()) {
            scope.coordinator.success(scope.key, startedAt);

            return sent;
        }

        const error = sent.unwrapErr();
        if (error.code !== 'REQUEST_FAILED') return sent;
        if (init.signal?.aborted || scope.signal?.aborted)
            return Err(SERVER_ERRORS.UPLOAD_CANCELLED);
        if (error.status === undefined) return sent;

        if (error.status === TOO_MANY_REQUESTS) {
            const seconds = scope.coordinator.pause(scope.key, error.retryAfterSeconds);

            return Err(throttleError(seconds));
        }

        if (error.status < SERVER_ERROR_MIN_STATUS) {
            scope.coordinator.serverSuccess(scope.key);

            return sent;
        }

        const seconds = scope.coordinator.serverFailure(scope.key);
        if (seconds === null || options.preserveServerFailure) return sent;

        return Err(throttleError(seconds));
    });
}

export function readBody(response: Response, stage: string): AsyncResult<Buffer, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const body = await response.arrayBuffer();

            return Ok(Buffer.from(body));
        } catch {
            return Err({ code: 'REQUEST_FAILED', message: `${stage} failed`, stage } as const);
        }
    });
}
