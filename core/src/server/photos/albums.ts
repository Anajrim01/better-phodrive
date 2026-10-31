import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { AlbumKeySchema, FolderPathSchema, MAX_ALBUM_BATCH_SIZE } from '../../models';
import { authenticatedHeaders } from './auth';
import { photosFetch, type Fetcher } from '../fetcher';
import { send, readBody } from './transport';
import { message, numberField, bytesField, bodyBytes, nested, utf8 } from '../protobuf';

const CREATE_ALBUM_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/8386163679468898444';
const ADD_MEDIA_TO_ALBUM_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/484917746253879292';
const DEVICE = message(bytesField(3, 'Pixel XL'), bytesField(4, 'Google'), numberField(5, 28));
const MEDIA_KEY_LENGTH_LIMIT = 2048;

export const MAX_ALBUM_NAME_LENGTH = 255;

export function assignFolderAlbum(
    email: string,
    token: string,
    folder: string,
    albumKey: string | undefined,
    mediaKeys: readonly string[],
    fetcher: Fetcher = photosFetch
): AsyncResult<string, ServerError> {
    return validateAssignment(folder, albumKey, mediaKeys)
        .andThenAsync(() => authenticatedHeaders(email, token, fetcher))
        .andThenAsync(({ rpcHeaders }) => {
            if (albumKey === undefined) return createAlbum(folder, mediaKeys, rpcHeaders, fetcher);

            return addMediaToAlbum(albumKey, mediaKeys, rpcHeaders, fetcher);
        });
}

function validateAssignment(
    folder: string,
    albumKey: string | undefined,
    mediaKeys: readonly string[]
): Result<void, ServerError> {
    if (!FolderPathSchema.safeParse(folder).success) return Err(SERVER_ERRORS.INVALID_FOLDER_PATH);

    if (albumKey !== undefined && !AlbumKeySchema.safeParse(albumKey).success)
        return Err(SERVER_ERRORS.INVALID_ALBUM_KEY);

    const validKeys =
        mediaKeys.length > 0 &&
        mediaKeys.length <= MAX_ALBUM_BATCH_SIZE &&
        mediaKeys.every((key) => key.length > 0 && key.length <= MEDIA_KEY_LENGTH_LIMIT);

    if (!validKeys) return Err(SERVER_ERRORS.INVALID_ALBUM_MEDIA_KEYS);

    return Ok(undefined);
}

function createAlbum(
    folder: string,
    mediaKeys: readonly string[],
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = message(
        bytesField(1, albumName(folder)),
        numberField(2, unixSeconds()),
        numberField(3, 1),
        ...mediaKeys.map((key) =>
            bytesField(4, message(bytesField(1, message(bytesField(1, key)))))
        ),
        bytesField(6, message()),
        bytesField(7, message(numberField(1, 3))),
        bytesField(8, DEVICE)
    );

    return send(
        fetcher,
        CREATE_ALBUM_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(request)
        },
        'Create album'
    ).andThenAsync((response) => readBody(response, 'Create album').andThen(albumKeyFromCreate));
}

function addMediaToAlbum(
    albumKey: string,
    mediaKeys: readonly string[],
    rpcHeaders: Record<string, string>,
    fetcher: Fetcher
): AsyncResult<string, ServerError> {
    const request = message(
        ...mediaKeys.map((key) => bytesField(1, key)),
        bytesField(2, albumKey),
        bytesField(5, message(numberField(1, 2))),
        bytesField(6, DEVICE),
        numberField(7, unixSeconds())
    );

    return send(
        fetcher,
        ADD_MEDIA_TO_ALBUM_URL,
        {
            method: 'POST',
            redirect: 'manual',
            headers: rpcHeaders,
            body: bodyBytes(request)
        },
        'Add media to album'
    ).andThenAsync((response) => readBody(response, 'Add media to album').map(() => albumKey));
}

function albumKeyFromCreate(response: Buffer): Result<string, ServerError> {
    return nested(response, 1, 1)
        .andThen(utf8)
        .mapErr(() => SERVER_ERRORS.ALBUM_CREATE_RESPONSE_FAILED)
        .andThen((key) =>
            AlbumKeySchema.safeParse(key).success
                ? Ok(key)
                : Err(SERVER_ERRORS.ALBUM_CREATE_RESPONSE_FAILED)
        );
}

/** Google rejects long album names, so deep folders reuse the start of their path. */
function albumName(folder: string): string {
    return folder.length > MAX_ALBUM_NAME_LENGTH ? folder.slice(0, MAX_ALBUM_NAME_LENGTH) : folder;
}

function unixSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
