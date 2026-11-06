import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import {
    bytes,
    bytesField,
    message,
    nested,
    numberField,
    optional,
    parse,
    utf8
} from '../../protobuf';

const RPC_BASE = 'https://photosdata-pa.googleapis.com/6439526531001121323';

export const CREATE_ALBUM_URL = `${RPC_BASE}/8386163679468898444`;
export const REMOVE_ALBUM_URL = `${RPC_BASE}/11165707358190966680`;
export const CREATE_ENVELOPE_URL = `${RPC_BASE}/11663664809460121647`;
export const DELETE_ENVELOPE_URL = `${RPC_BASE}/8089014401670041416`;
export const UPDATE_LINK_STATE_URL =
    'https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.sharingdata.v1.PhotosSharingDataService/PhotosUpdateLinkSharingState';

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
const DEVICE = message(bytesField(3, 'Pixel XL'), bytesField(4, 'Google'), numberField(5, 28));

// Keys and auth keys are opaque, but they are re-sent in requests and URLs.
const OPAQUE_KEY = /^[^\s\0]+$/;
const SHORT_URL = /^https:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9_-]+$/;

export type ShareEnvelope = { envelopeKey: string; pendingShortUrl?: string };
export type EnabledLink = { shortUrl: string; authKey: string };

function invalid(): Result<never, ServerError> {
    return Err(SERVER_ERRORS.GOOGLE_SHARE_RESPONSE_INVALID);
}

function opaqueKey(value: Buffer): Result<string, ServerError> {
    return utf8(value).andThen((key) => (OPAQUE_KEY.test(key) ? Ok(key) : invalid()));
}

function shortUrl(value: Buffer): Result<string, ServerError> {
    return utf8(value).andThen((url) => (SHORT_URL.test(url) ? Ok(url) : invalid()));
}

function permission(permissionClass: number, permissionType: number): Buffer {
    return message(
        bytesField(
            1,
            message(numberField(1, permissionClass - 1), numberField(2, permissionType - 1))
        ),
        numberField(2, 0)
    );
}

export function createAlbumRequest(
    title: string,
    mediaKeys: readonly string[],
    now = Date.now()
): Buffer {
    return message(
        bytesField(1, title),
        numberField(2, now),
        numberField(3, 1),
        ...mediaKeys.map((key) =>
            bytesField(4, message(bytesField(1, message(bytesField(1, key)))))
        ),
        bytesField(6, message()),
        bytesField(7, message(numberField(1, 3))),
        bytesField(8, DEVICE)
    );
}

export function removeAlbumRequest(albumKey: string): Buffer {
    return bytesField(1, albumKey);
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

export function parseCreatedAlbum(body: Buffer): Result<string, ServerError> {
    return nested(body, 1, 1).andThen(opaqueKey);
}

// Empty protobuf acknowledgment is a probe hypothesis, not proof the resource disappeared.
export function parseEmptyShareReply(body: Buffer): Result<void, ServerError> {
    return body.length === 0 ? Ok(undefined) : invalid();
}

export function parseEnvelopeResponse(body: Buffer): Result<ShareEnvelope, ServerError> {
    return parse(body).andThen((fields) =>
        bytes(fields, 1)
            .andThen(opaqueKey)
            .andThen((envelopeKey) => {
                const pending = optional(fields, 2);
                if (!pending) return Ok({ envelopeKey });
                if (typeof pending.value === 'number') return invalid();

                return shortUrl(pending.value).map((pendingShortUrl) => ({
                    envelopeKey,
                    pendingShortUrl
                }));
            })
    );
}

export function parseLinkStateResponse(body: Buffer): Result<EnabledLink, ServerError> {
    return nested(body, 1, 1)
        .andThen(shortUrl)
        .andThen((url) =>
            nested(body, 2)
                .andThen(opaqueKey)
                .map((authKey) => ({ shortUrl: url, authKey }))
        );
}
