import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { Sha1HexSchema } from '../../models';
import { authenticatedHeaders } from './auth';
import { photosFetch, type Fetcher } from '../fetcher';
import { guardedSend, readBody } from './transport';
import { validateDeleteResponse } from './delete-response';
import { message, numberField, bytesField, bodyBytes } from '../protobuf';

const TRASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/17490284929287180316';

export function moveToTrash(
    email: string,
    token: string,
    sha1: string,
    fetcher: Fetcher = photosFetch,
    mediaKey: string
): AsyncResult<void, ServerError> {
    return moveToTrashBatch(email, token, [sha1], fetcher, [mediaKey]);
}

export function moveToTrashBatch(
    email: string,
    token: string,
    sha1s: readonly string[],
    fetcher: Fetcher = photosFetch,
    mediaKeys: readonly string[]
): AsyncResult<void, ServerError> {
    if (sha1s.length === 0) return Ok(undefined).andThenAsync(async () => Ok(undefined));

    const validHashes = sha1s.every((sha1) => Sha1HexSchema.safeParse(sha1).success)
        ? Ok(sha1s)
        : Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);
    if (validHashes.isErr()) return Ok(undefined).andThenAsync(async () => validHashes);

    return validHashes
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ commonHeaders }) => {
            const dedupKeys = sha1s.map((sha1) => Buffer.from(sha1, 'hex').toString('base64url'));
            const body = message(
                numberField(2, 1),
                ...dedupKeys.map((key) => bytesField(3, key)),
                numberField(4, 1),
                bytesField(
                    8,
                    bytesField(
                        4,
                        message(
                            bytesField(2, Buffer.alloc(0)),
                            bytesField(3, bytesField(1, Buffer.alloc(0))),
                            bytesField(4, Buffer.alloc(0)),
                            bytesField(5, bytesField(1, Buffer.alloc(0)))
                        )
                    )
                ),
                bytesField(
                    9,
                    message(
                        numberField(1, 5),
                        bytesField(2, message(numberField(1, 49029607), bytesField(2, '28')))
                    )
                )
            );

            return guardedSend(
                email,
                fetcher,
                TRASH_URL,
                {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { ...commonHeaders, 'content-type': 'application/x-protobuf' },
                    body: bodyBytes(body)
                },
                'Move to trash'
            ).andThenAsync((response) =>
                readBody(response, 'Move to trash').andThen((body) =>
                    validateDeleteResponse(body, new Set(mediaKeys))
                )
            );
        });
}
