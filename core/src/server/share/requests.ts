import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type Result } from 'results-ts';
import { AlbumKeySchema } from '../../models';
import { ShareShortUrlSchema } from '../../share-models';
import { bytes, message, nested, numberField, bytesField, parse, utf8 } from '../protobuf';

export const CREATE_ENVELOPE_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/11663664809460121647';
export const UPDATE_LINK_STATE_URL =
    'https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.sharingdata.v1.PhotosSharingDataService/PhotosUpdateLinkSharingState';
export const DELETE_ENVELOPE_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/8089014401670041416';

export const LINK_STATE_ENABLED = 2;
export const LINK_STATE_DISABLED = 1;

const ENVELOPE_TYPE_ALBUM = 1;
const ENVELOPE_SOURCE = 2;
const PERMISSION_PAIRS = [
    [3, 2],
    [3, 3],
    [2, 2],
    [2, 3],
    [4, 2]
] as const;
const CLIENT_INFO_FIELDS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 15, 18, 20];
const RESPONSE_MASKS = [4, 2, 3, 6, 7, 8];
const CLIENT_INFO = message(
    bytesField(1, message(...CLIENT_INFO_FIELDS.map((field) => bytesField(field, message()))))
);

function permission(permissionClass: number, permissionType: number): Buffer {
    return message(
        bytesField(
            1,
            message(numberField(1, permissionClass - 1), numberField(2, permissionType - 1))
        ),
        numberField(2, 0)
    );
}

export function createEnvelopeRequest(albumKey: string, title: string, now = Date.now()): Buffer {
    const album = message(
        numberField(1, ENVELOPE_TYPE_ALBUM),
        bytesField(2, message(bytesField(1, message(bytesField(1, albumKey))))),
        numberField(9, ENVELOPE_SOURCE),
        bytesField(10, title)
    );
    const permissions = message(
        numberField(2, 1),
        numberField(5, 1),
        ...PERMISSION_PAIRS.map(([permissionClass, permissionType]) =>
            bytesField(7, permission(permissionClass, permissionType))
        )
    );

    return message(
        bytesField(3, permissions),
        bytesField(4, album),
        bytesField(5, CLIENT_INFO),
        numberField(8, now),
        ...RESPONSE_MASKS.map((mask) => numberField(9, mask)),
        bytesField(10, CLIENT_INFO)
    );
}

export function linkStateRequest(envelopeKey: string, state: number): Buffer {
    return message(bytesField(1, message(bytesField(1, envelopeKey))), numberField(2, state));
}

export function deleteEnvelopeRequest(envelopeKey: string): Buffer {
    return bytesField(1, envelopeKey);
}

export function parseEnvelopeResponse(
    body: Buffer
): Result<{ envelopeKey: string; pendingShortUrl?: string }, ServerError> {
    return parse(body)
        .andThen((fields) => bytes(fields, 1))
        .andThen(utf8)
        .andThen((envelopeKey) =>
            AlbumKeySchema.safeParse(envelopeKey).success
                ? Ok(envelopeKey)
                : Err(SERVER_ERRORS.SHARE_ENVELOPE_RESPONSE_FAILED)
        )
        .andThen((envelopeKey) =>
            optionalShortUrl(body).map((pendingShortUrl) => ({
                envelopeKey,
                ...(pendingShortUrl === undefined ? {} : { pendingShortUrl })
            }))
        );
}

export function parseLinkStateResponse(
    body: Buffer
): Result<{ shortUrl: string; authKey: string }, ServerError> {
    return nested(body, 1, 1)
        .andThen(utf8)
        .andThen((shortUrl) =>
            ShareShortUrlSchema.safeParse(shortUrl).success
                ? Ok(shortUrl)
                : Err(SERVER_ERRORS.SHARE_LINK_RESPONSE_FAILED)
        )
        .andThen((shortUrl) =>
            parse(body)
                .andThen((fields) => bytes(fields, 2))
                .andThen(utf8)
                .andThen((authKey) =>
                    authKey.length > 0 && authKey.length <= 4096 && !/[\s\0]/.test(authKey)
                        ? Ok({ shortUrl, authKey })
                        : Err(SERVER_ERRORS.SHARE_LINK_RESPONSE_FAILED)
                )
        );
}

function optionalShortUrl(body: Buffer): Result<string | undefined, ServerError> {
    const fields = parse(body);
    if (fields.isErr()) return fields;

    const pending = fields.unwrap().find((field) => field.number === 2);
    if (pending === undefined) return Ok(undefined);
    if (typeof pending.value === 'number') return Err(SERVER_ERRORS.SHARE_ENVELOPE_RESPONSE_FAILED);

    return utf8(pending.value).andThen((value) =>
        ShareShortUrlSchema.safeParse(value).success
            ? Ok(value)
            : Err(SERVER_ERRORS.SHARE_ENVELOPE_RESPONSE_FAILED)
    );
}
