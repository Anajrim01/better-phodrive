import type { AsyncResult } from 'results-ts';
import type { ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { bodyBytes } from '../../protobuf';
import type { ThrottleScope } from '../throttle';
import { guardedSend, readBody } from '../transport';
import {
    createAlbumRequest,
    createEnvelopeRequest,
    CREATE_ALBUM_URL,
    CREATE_ENVELOPE_URL,
    deleteEnvelopeRequest,
    DELETE_ENVELOPE_URL,
    LINK_STATE_DISABLED,
    LINK_STATE_ENABLED,
    linkStateRequest,
    parseCreatedAlbum,
    parseEmptyShareReply,
    parseEnvelopeResponse,
    parseLinkStateResponse,
    removeAlbumRequest,
    REMOVE_ALBUM_URL,
    UPDATE_LINK_STATE_URL,
    type EnabledLink,
    type ShareEnvelope
} from './google-requests';

export type OwnerRpc = {
    rpcHeaders: Record<string, string>;
    fetcher: Fetcher;
    scope: ThrottleScope;
};

/** How a failed mutation left the account: only a definite refusal proves nothing changed. */
export type MutationFailure = 'gone' | 'rejected' | 'uncertain';

function post(
    { rpcHeaders, fetcher, scope }: OwnerRpc,
    url: string,
    request: Buffer,
    stage: string
): AsyncResult<Buffer, ServerError> {
    return guardedSend(
        scope,
        fetcher,
        url,
        { method: 'POST', redirect: 'manual', headers: rpcHeaders, body: bodyBytes(request) },
        stage,
        { preserveServerFailure: true }
    ).andThenAsync((response) => readBody(response, stage));
}

export function createShareAlbum(
    rpc: OwnerRpc,
    title: string,
    mediaKeys: readonly string[]
): AsyncResult<string, ServerError> {
    return post(
        rpc,
        CREATE_ALBUM_URL,
        createAlbumRequest(title, mediaKeys),
        'Create album'
    ).andThen(parseCreatedAlbum);
}

export function removeShareAlbum(rpc: OwnerRpc, albumKey: string): AsyncResult<void, ServerError> {
    return post(rpc, REMOVE_ALBUM_URL, removeAlbumRequest(albumKey), 'Remove album').andThen(
        parseEmptyShareReply
    );
}

export function createShareEnvelope(
    rpc: OwnerRpc,
    albumKey: string,
    title: string
): AsyncResult<ShareEnvelope, ServerError> {
    return post(
        rpc,
        CREATE_ENVELOPE_URL,
        createEnvelopeRequest(albumKey, title),
        'Create envelope'
    ).andThen(parseEnvelopeResponse);
}

export function deleteShareEnvelope(
    rpc: OwnerRpc,
    envelopeKey: string
): AsyncResult<void, ServerError> {
    return post(
        rpc,
        DELETE_ENVELOPE_URL,
        deleteEnvelopeRequest(envelopeKey),
        'Delete envelope'
    ).andThen(parseEmptyShareReply);
}

export function enableShareLink(
    rpc: OwnerRpc,
    envelopeKey: string
): AsyncResult<EnabledLink, ServerError> {
    return post(
        rpc,
        UPDATE_LINK_STATE_URL,
        linkStateRequest(envelopeKey, LINK_STATE_ENABLED),
        'Enable link'
    ).andThen(parseLinkStateResponse);
}

export function disableShareLink(
    rpc: OwnerRpc,
    envelopeKey: string
): AsyncResult<void, ServerError> {
    return post(
        rpc,
        UPDATE_LINK_STATE_URL,
        linkStateRequest(envelopeKey, LINK_STATE_DISABLED),
        'Disable link'
    )
        .andThen(parseLinkStateResponse)
        .map(() => undefined);
}

export function classifyMutationFailure(error: ServerError): MutationFailure {
    if (error.code !== 'REQUEST_FAILED' || error.status === undefined) return 'uncertain';
    if (error.status === 404 || error.status === 410) return 'gone';

    const refused = error.status >= 400 && error.status < 500;

    return refused && error.status !== 408 && error.status !== 429 ? 'rejected' : 'uncertain';
}
