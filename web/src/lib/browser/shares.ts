import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { apiJson } from '@madkarmaa/phodrive-core/browser/api';
import {
    PublicShareSchema,
    ShareChunkSessionSchema,
    ShareListResponseSchema,
    ShareResponseSchema,
    type CreateShareRequest,
    type PublicShare,
    type ShareChunkSession,
    type ShareSummary
} from '@madkarmaa/phodrive-core/models';
import { schemaResult } from '@madkarmaa/phodrive-core/validation';
import type { AsyncResult } from 'results-ts';

const SHARES_URL = '/api/shares';
const PUBLIC_URL = '/api/public/shares';
const CREATE_FAILED = 'Could not create this share. Try again.';
const LIST_FAILED = 'Could not load shares. Try again.';
const REVOKE_FAILED = 'Could not revoke this share. Try again.';
const PUBLIC_FAILED = 'This share is unavailable.';
const CHUNK_FAILED = 'This download capability could not be issued.';

export function createShareRequest(
    input: CreateShareRequest
): AsyncResult<ShareSummary, ApplicationError> {
    return apiJson(
        SHARES_URL,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
        },
        CREATE_FAILED
    ).andThen((body) =>
        schemaResult(ShareResponseSchema, body, CREATE_FAILED).map((data) => data.share)
    );
}

export function listShares(): AsyncResult<ShareSummary[], ApplicationError> {
    return apiJson(SHARES_URL, { method: 'GET' }, LIST_FAILED).andThen((body) =>
        schemaResult(ShareListResponseSchema, body, LIST_FAILED).map((data) => data.shares)
    );
}

export function revokeShare(id: string): AsyncResult<ShareSummary, ApplicationError> {
    return apiJson(
        `${SHARES_URL}/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
        REVOKE_FAILED
    ).andThen((body) =>
        schemaResult(ShareResponseSchema, body, REVOKE_FAILED).map((data) => data.share)
    );
}

export function getPublicShare(
    token: string,
    signal?: AbortSignal
): AsyncResult<PublicShare, ApplicationError> {
    return apiJson(
        `${PUBLIC_URL}/${encodeURIComponent(token)}`,
        { method: 'GET', ...(signal ? { signal } : {}) },
        PUBLIC_FAILED
    ).andThen((body) => schemaResult(PublicShareSchema, body, PUBLIC_FAILED));
}

export function getShareChunk(
    token: string,
    fileId: string,
    index: number,
    signal?: AbortSignal
): AsyncResult<ShareChunkSession, ApplicationError> {
    return apiJson(
        `${PUBLIC_URL}/${encodeURIComponent(token)}/files/${encodeURIComponent(
            fileId
        )}/chunks/${index}`,
        { method: 'POST', ...(signal ? { signal } : {}) },
        CHUNK_FAILED
    ).andThen((body) => schemaResult(ShareChunkSessionSchema, body, CHUNK_FAILED));
}
