import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { guardedSend, readBody } from '../transport';
import {
    message,
    numberField,
    bytesField,
    bodyBytes,
    bytes,
    integer,
    nested,
    parse
} from '../../protobuf';
import type { Fetcher } from '../../fetcher';
import { readMediaKey } from './lookup';

const UPLOAD_URL = 'https://photos.googleapis.com/data/upload/uploadmedia/interactive';
const COMMIT_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/16538846908252377752';

export type Transfer = { scotty: Buffer; type: number; token: Buffer };

export function startUpload(
    email: string,
    length: number,
    sha1: Buffer,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = message(
        numberField(1, 2),
        numberField(2, 2),
        numberField(3, 1),
        numberField(4, 3),
        numberField(7, length)
    );

    return guardedSend(
        email,
        fetcher,
        UPLOAD_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: {
                ...commonHeaders,
                'content-type': 'application/x-protobuf',
                'x-goog-hash': `sha1=${sha1.toString('base64')}`,
                'x-upload-content-length': String(length)
            },
            body: bodyBytes(request)
        },
        'Upload start'
    ).andThenAsync((response) =>
        readBody(response, 'Upload start').andThen(() => {
            const uploadId = response.headers.get('x-guploader-uploadid');

            return uploadId ? Ok(uploadId) : Err(SERVER_ERRORS.UPLOAD_START_RESPONSE_FAILED);
        })
    );
}

export function transferBmp(
    email: string,
    body: BodyInit,
    uploadId: string,
    commonHeaders: Record<string, string>,
    fetcher: Fetcher,
    length?: number
): AsyncResult<Transfer, ServerError> {
    const url = new URL(UPLOAD_URL);
    url.searchParams.set('upload_id', uploadId);

    return guardedSend(
        email,
        fetcher,
        url,
        {
            method: 'PUT',
            redirect: 'manual',
            headers: {
                ...commonHeaders,
                ...(length === undefined ? {} : { 'content-length': String(length) })
            },
            body
        },
        'Upload transfer'
    ).andThenAsync((response) => readBody(response, 'Upload transfer').andThen(parseTransfer));
}

export function commitBmp(
    email: string,
    name: string,
    sha1: Buffer,
    transfer: Transfer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const media = message(
        bytesField(1, message(numberField(1, transfer.type), bytesField(2, transfer.token))),
        bytesField(2, name),
        bytesField(3, sha1),
        bytesField(
            4,
            message(numberField(1, Math.floor(Date.now() / 1000)), numberField(2, 46_000_000))
        ),
        numberField(7, 3),
        numberField(10, 1)
    );
    const device = message(bytesField(3, 'Pixel XL'), bytesField(4, 'Google'), numberField(5, 28));
    const request = message(
        bytesField(1, media),
        bytesField(2, device),
        bytesField(3, Buffer.from([1, 3]))
    );

    return guardedSend(
        email,
        fetcher,
        COMMIT_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(request)
        },
        'Commit'
    )
        .andThenAsync((response) =>
            readBody(response, 'Commit').andThen((body) => mediaFromCommit(body, transfer.scotty))
        )
        .mapErr((error) =>
            error.code === 'COMMIT_REJECTED' || error.code === 'THROTTLED'
                ? error
                : SERVER_ERRORS.COMMIT_OUTCOME_UNCERTAIN
        );
}

function mediaFromCommit(response: Buffer, scotty: Buffer): Result<string, ServerError> {
    return nested(response, 1)
        .andThen(parse)
        .andThen((item) =>
            bytes(item, 1).andThen((token) => {
                if (!token.equals(scotty)) return Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH);

                return integer(item, 2).map((status) => ({ item, status }));
            })
        )
        .andThen(({ item, status }): Result<string, ServerError> => {
            if (status === 10 && !item.some((field) => field.number === 3))
                return Err(SERVER_ERRORS.COMMIT_REJECTED);
            if (status !== 0) return Err(SERVER_ERRORS.UNKNOWN_COMMIT_STATUS);

            return readMediaKey(item, 3);
        });
}

function parseTransfer(scotty: Buffer): Result<Transfer, ServerError> {
    return parse(scotty).andThen((fields) =>
        integer(fields, 1).andThen((type) =>
            bytes(fields, 2).andThen((token) =>
                type === 2 && token.length
                    ? Ok({ scotty, type, token })
                    : Err(SERVER_ERRORS.INVALID_TRANSFER_TOKEN)
            )
        )
    );
}
