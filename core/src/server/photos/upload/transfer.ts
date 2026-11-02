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
    optional,
    parse,
    type Field
} from '../../protobuf';
import type { Fetcher } from '../../fetcher';
import { readMediaKey } from './lookup';

const UPLOAD_URL = 'https://photos.googleapis.com/data/upload/uploadmedia/interactive';
const COMMIT_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/16538846908252377752';

export type Transfer = { scotty: Buffer; type: number; token: Buffer };
export type CommitItem = { name: string; sha1: Buffer; transfer: Transfer };
export type CommitOutcome = ReadonlyMap<string, Result<string, ServerError>>;

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
    const token = transfer.scotty.toString('hex');

    return commitBmpMany(email, [{ name, sha1, transfer }], rpcHeaders, fetcher)
        .andThen((outcome) => outcome.get(token) ?? Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH))
        .mapErr(commitFailure);
}

export function commitBmpMany(
    email: string,
    items: readonly CommitItem[],
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<CommitOutcome, ServerError> {
    if (items.length === 0)
        return Ok(undefined).andThenAsync<CommitOutcome, ServerError>(async () => Ok(new Map()));

    return guardedSend(
        email,
        fetcher,
        COMMIT_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(commitRequest(items))
        },
        'Commit',
        { preserveServerFailure: true }
    ).andThenAsync((response) =>
        readBody(response, 'Commit').andThen((body) => commitOutcome(body, items))
    );
}

export function commitFailure(error: ServerError): ServerError {
    return error.code === 'COMMIT_REJECTED' || error.code === 'THROTTLED'
        ? error
        : SERVER_ERRORS.COMMIT_OUTCOME_UNCERTAIN;
}

function commitRequest(items: readonly CommitItem[]): Buffer {
    const capturedAt = Math.floor(Date.now() / 1000);
    const media = items.map(({ name, sha1, transfer }) =>
        bytesField(
            1,
            message(
                bytesField(
                    1,
                    message(numberField(1, transfer.type), bytesField(2, transfer.token))
                ),
                bytesField(2, name),
                bytesField(3, sha1),
                bytesField(4, message(numberField(1, capturedAt), numberField(2, 46_000_000))),
                numberField(7, 3),
                numberField(10, 1)
            )
        )
    );
    const device = message(bytesField(3, 'Pixel XL'), bytesField(4, 'Google'), numberField(5, 28));

    return message(...media, bytesField(2, device), bytesField(3, Buffer.from([1, 3])));
}

function commitOutcome(
    response: Buffer,
    items: readonly CommitItem[]
): Result<CommitOutcome, ServerError> {
    return parse(response).andThen((fields) => {
        const known = new Set(items.map(tokenOf));
        const results = new Map<string, Result<string, ServerError>>();
        let index = 0;
        let positional = false;

        for (const field of fields) {
            if (field.number !== 1) continue;
            if (typeof field.value === 'number')
                return Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD_TYPE);

            const entry = parse(field.value);
            if (entry.match({ Ok: (fields) => !optional(fields, 1), Err: () => false }))
                positional = true;

            const applied = entry.andThen((fields) =>
                applyCommitEntry(fields, index, items, known, results)
            );
            const failure = applied.match<ServerError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            if (failure) return Err(failure);

            index++;
        }
        if (positional && index !== items.length) return Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH);

        return Ok(results);
    });
}

function applyCommitEntry(
    entry: Field[],
    index: number,
    items: readonly CommitItem[],
    known: ReadonlySet<string>,
    results: Map<string, Result<string, ServerError>>
): Result<void, ServerError> {
    return tokenFor(entry, index, items).andThen((token) => {
        if (!known.has(token) || results.has(token))
            return Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH);

        results.set(token, commitEntry(entry));

        return Ok(undefined);
    });
}

function tokenFor(
    entry: Field[],
    index: number,
    items: readonly CommitItem[]
): Result<string, ServerError> {
    const field = optional(entry, 1);
    if (field) {
        if (typeof field.value === 'number') return Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD_TYPE);

        return Ok(field.value.toString('hex'));
    }

    const item = items[index];

    return item ? Ok(tokenOf(item)) : Err(SERVER_ERRORS.COMMIT_TOKEN_MISMATCH);
}

function tokenOf(item: CommitItem): string {
    return item.transfer.scotty.toString('hex');
}

function commitEntry(entry: Field[]): Result<string, ServerError> {
    return integer(entry, 2).andThen((status) => {
        if (status === 10 && !entry.some((field) => field.number === 3))
            return Err(SERVER_ERRORS.COMMIT_REJECTED);
        if (status !== 0) return Err(SERVER_ERRORS.UNKNOWN_COMMIT_STATUS);

        return readMediaKey(entry, 3);
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
