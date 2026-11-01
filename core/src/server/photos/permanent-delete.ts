import { SERVER_ERRORS, type ServerError } from '../errors';
import { Ok, type AsyncResult, Err } from 'results-ts';
import { Sha1HexSchema } from '../../models';
import { authenticatedHeaders } from './auth';
import { photosFetch, type Fetcher } from '../fetcher';
import { guardedSend, readBody } from './transport';
import { message, numberField, bytesField, bodyBytes } from '../protobuf';

const TRASH_URL = 'https://photosdata-pa.googleapis.com/6439526531001121323/17490284929287180316';

export function deletePermanently(
    email: string,
    token: string,
    sha1s: readonly string[],
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    if (sha1s.length === 0) return Ok(undefined).andThenAsync(async () => Ok(undefined));

    const valid = sha1s.every((sha1) => Sha1HexSchema.safeParse(sha1).success)
        ? Ok(sha1s)
        : Err(SERVER_ERRORS.INVALID_FILE_REFERENCE);
    if (valid.isErr()) return Ok(undefined).andThenAsync(async () => valid);

    return valid
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ commonHeaders }) => {
            const dedupKeys = sha1s.map((sha1) => Buffer.from(sha1, 'hex').toString('base64url'));
            const body = message(
                numberField(2, 2),
                ...dedupKeys.map((key) => bytesField(3, key)),
                numberField(4, 2),
                bytesField(
                    8,
                    bytesField(
                        4,
                        message(
                            bytesField(2, Buffer.alloc(0)),
                            bytesField(3, bytesField(1, Buffer.alloc(0)))
                        )
                    )
                ),
                bytesField(9, Buffer.alloc(0))
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
                'Delete permanently'
            ).andThenAsync((response) =>
                readBody(response, 'Delete permanently').map(() => undefined)
            );
        });
}
