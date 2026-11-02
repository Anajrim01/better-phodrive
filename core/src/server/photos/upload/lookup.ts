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

export type HashLookupResults = ReadonlyMap<string, string | null>;

export function hashLookup(
    email: string,
    sha1: Buffer,
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string | null, ServerError> {
    return guardedSend(
        email,
        fetcher,
        HASH_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(hashRequestBody([sha1]))
        },
        'Hash lookup'
    ).andThenAsync((response) =>
        readBody(response, 'Hash lookup').andThen((body) => existingMedia(body, sha1))
    );
}

export function hashLookupMany(
    email: string,
    sha1s: readonly Buffer[],
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<HashLookupResults, ServerError> {
    const unique = new Map<string, Buffer>();
    for (const sha1 of sha1s) unique.set(sha1.toString('hex'), sha1);

    if (unique.size === 0)
        return Ok(undefined).andThenAsync(async () => Ok(new Map<string, string | null>()));

    return guardedSend(
        email,
        fetcher,
        HASH_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(hashRequestBody([...unique.values()]))
        },
        'Hash lookup'
    ).andThenAsync((response) =>
        readBody(response, 'Hash lookup').andThen((body) => existingMediaMany(body, unique))
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

function hashRequestBody(sha1s: readonly Buffer[]): Buffer {
    return bytesField(
        1,
        message(
            ...sha1s.map((sha1) => bytesField(1, bytesField(1, sha1))),
            bytesField(2, Buffer.alloc(0))
        )
    );
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

function existingMediaMany(
    response: Buffer,
    hashes: ReadonlyMap<string, Buffer>
): Result<HashLookupResults, ServerError> {
    const results = new Map<string, string | null>();
    for (const hex of hashes.keys()) results.set(hex, null);

    return nested(response, 1)
        .andThen(parse)
        .andThen((entries) => {
            for (const entry of entries) {
                if (entry.number !== 2) continue;
                if (typeof entry.value === 'number')
                    return Err(SERVER_ERRORS.INVALID_PROTOBUF_FIELD_TYPE);

                const failure = existingMediaEntry(entry.value).match<ServerError | null>({
                    Ok: ({ hash, key }) => {
                        if (results.has(hash)) results.set(hash, key);

                        return null;
                    },
                    Err: (error) => error
                });
                if (failure) return Err(failure);
            }

            return Ok(results);
        });
}

function existingMediaEntry(
    entry: Buffer
): Result<{ hash: string; key: string | null }, ServerError> {
    return parse(entry).andThen((fields) =>
        bytes(fields, 1)
            .andThen((data) => nested(data, 1))
            .andThen((foundHash) => {
                const hash = foundHash.toString('hex');
                if (!fields.some((field) => field.number === 2))
                    return Ok<{ hash: string; key: string | null }>({ hash, key: null });

                return readMediaKey(fields, 2).map((key) => ({ hash, key }));
            })
    );
}
