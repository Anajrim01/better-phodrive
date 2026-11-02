import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { guardedSend, readBody } from '../transport';
import {
    message,
    bytesField,
    bodyBytes,
    bytes,
    nested,
    parse,
    utf8,
    type Field
} from '../../protobuf';
import type { Fetcher } from '../../fetcher';

const HASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/5084965799730810217';

export function hashLookup(
    email: string,
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string | null, ServerError> {
    const hashRequest = bytesField(
        1,
        message(bytesField(1, bytesField(1, sha1)), bytesField(2, Buffer.alloc(0)))
    );

    return guardedSend(
        email,
        fetcher,
        HASH_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(hashRequest)
        },
        'Hash lookup'
    ).andThenAsync((response) =>
        readBody(response, 'Hash lookup').andThen((body) => existingMedia(body, sha1))
    );
}

export function readMediaKey(item: Field[], field: number): Result<string, ServerError> {
    return bytes(item, field)
        .andThen((data) => nested(data, 1))
        .andThen(utf8)
        .andThen((key) => {
            if (!key) return Err(SERVER_ERRORS.MISSING_MEDIA_KEY);

            return Ok(key);
        });
}

function existingMedia(response: Buffer, sha1: Buffer): Result<string | null, ServerError> {
    return nested(response, 1, 2)
        .andThen(parse)
        .andThen((matched) =>
            bytes(matched, 1)
                .andThen((data) => nested(data, 1))
                .map((foundHash) => ({ matched, foundHash }))
        )
        .andThen(({ matched, foundHash }) => {
            if (!foundHash.equals(sha1)) return Err(SERVER_ERRORS.HASH_LOOKUP_MISMATCH);
            if (!matched.some((field) => field.number === 2)) return Ok(null);

            return readMediaKey(matched, 2);
        });
}
