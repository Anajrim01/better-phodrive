import type { ServerError } from '../errors';
import type { AsyncResult } from 'results-ts';
import type { Fetcher } from '../fetcher';
import { authenticatedHeaders } from '../photos/auth';
import { guardedSend, readBody } from '../photos/transport';
import { bodyBytes } from '../protobuf';
import {
    CREATE_ENVELOPE_URL,
    createEnvelopeRequest,
    DELETE_ENVELOPE_URL,
    deleteEnvelopeRequest,
    parseEnvelopeResponse
} from './requests';

export function createEnvelope(
    email: string,
    token: string,
    albumKey: string,
    title: string,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = createEnvelopeRequest(albumKey, title);

    return authenticatedHeaders(email, token, fetcher).andThenAsync(({ rpcHeaders }) =>
        guardedSend(
            email,
            fetcher,
            CREATE_ENVELOPE_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: rpcHeaders,
                body: bodyBytes(request)
            },
            'Create share envelope'
        ).andThenAsync((response) =>
            readBody(response, 'Create share envelope').andThen((body) =>
                parseEnvelopeResponse(body).map((envelope) => envelope.envelopeKey)
            )
        )
    );
}

export function deleteEnvelope(
    email: string,
    token: string,
    envelopeKey: string,
    fetcher: Fetcher
): AsyncResult<void, ServerError> {
    const request = deleteEnvelopeRequest(envelopeKey);

    return authenticatedHeaders(email, token, fetcher).andThenAsync(({ rpcHeaders }) =>
        guardedSend(
            email,
            fetcher,
            DELETE_ENVELOPE_URL,
            {
                method: 'POST',
                redirect: 'manual',
                headers: rpcHeaders,
                body: bodyBytes(request)
            },
            'Delete share envelope'
        ).andThenAsync((response) =>
            readBody(response, 'Delete share envelope').map(() => undefined)
        )
    );
}

export function alreadyGone(error: ServerError): boolean {
    return error.code === 'REQUEST_FAILED' && (error.status === 404 || error.status === 410);
}
