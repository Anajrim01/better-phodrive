import type { ApplicationError } from '../errors';
import type { AsyncResult } from 'results-ts';
import {
    ShareCreateResponseSchema,
    ShareRevokeResponseSchema,
    type ShareCreateRequest,
    type ShareCreateResponse,
    type ShareRevokeRequest,
    type ShareRevokeResponse
} from '../share-models';
import { apiJson } from './api';
import { schemaResult } from '../validation';

const SHARE_MESSAGE = 'Could not update the share.';

export function requestShareCreate(
    input: ShareCreateRequest
): AsyncResult<ShareCreateResponse, ApplicationError> {
    return apiJson(
        '/api/share',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
        },
        SHARE_MESSAGE
    ).andThen((value) => schemaResult(ShareCreateResponseSchema, value, SHARE_MESSAGE));
}

export function requestShareRevoke(
    input: ShareRevokeRequest
): AsyncResult<ShareRevokeResponse, ApplicationError> {
    return apiJson(
        '/api/share',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
        },
        SHARE_MESSAGE
    ).andThen((value) => schemaResult(ShareRevokeResponseSchema, value, SHARE_MESSAGE));
}
