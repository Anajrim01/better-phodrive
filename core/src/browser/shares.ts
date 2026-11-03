import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { z } from 'zod';
import {
    ShareCreateResponseSchema,
    ShareErrorResponseSchema,
    ShareRevokeResponseSchema,
    type ShareCreateRequest,
    type ShareCreateResponse,
    type ShareRecovery,
    type ShareRevokeRequest,
    type ShareRevokeResponse
} from '../share-models';
import { schemaResult } from '../validation';

const SHARE_MESSAGE = 'Could not update the share.';

/** Share failures keep the server code and recovery keys for owner guidance. */
export type ShareFailure = {
    readonly code: string;
    readonly message: string;
    readonly recovery?: ShareRecovery;
    readonly retryAfterSeconds?: number;
};

function shareFailure(
    code: string,
    message: string,
    recovery: ShareRecovery | undefined,
    retryAfterSeconds: number | undefined
): ShareFailure {
    return {
        code,
        message,
        ...(recovery === undefined ? {} : { recovery }),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
    };
}

function shareRequest<T>(
    schema: z.ZodType<T>,
    input: ShareCreateRequest | ShareRevokeRequest
): AsyncResult<T, ShareFailure> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<T, ShareFailure>> => {
        let response: Response;

        try {
            response = await fetch('/api/share', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(input)
            });
        } catch {
            return Err(shareFailure('REQUEST_FAILED', SHARE_MESSAGE, undefined, undefined));
        }

        let body: unknown;

        try {
            body = await response.json();
        } catch {
            return Err(shareFailure('REQUEST_FAILED', SHARE_MESSAGE, undefined, undefined));
        }

        if (response.ok) {
            const parsed = schemaResult(schema, body, SHARE_MESSAGE);

            return parsed.mapErr(() =>
                shareFailure('REQUEST_FAILED', SHARE_MESSAGE, undefined, undefined)
            );
        }

        const parsed = ShareErrorResponseSchema.safeParse(body);
        if (!parsed.success)
            return Err(shareFailure('REQUEST_FAILED', SHARE_MESSAGE, undefined, undefined));

        return Err(
            shareFailure(
                parsed.data.code ?? 'REQUEST_FAILED',
                parsed.data.error,
                parsed.data.recovery,
                parsed.data.retryAfterSeconds
            )
        );
    });
}

export function requestShareCreate(
    input: ShareCreateRequest
): AsyncResult<ShareCreateResponse, ShareFailure> {
    return shareRequest(ShareCreateResponseSchema, input);
}

export function requestShareRevoke(
    input: ShareRevokeRequest
): AsyncResult<ShareRevokeResponse, ShareFailure> {
    return shareRequest(ShareRevokeResponseSchema, input);
}
