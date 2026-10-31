import type { ApplicationError } from '../errors';
import type { AsyncResult } from 'results-ts';
import { AlbumAssignResponseSchema, type AlbumAssignRequest } from '../models';
import { schemaResult } from '../validation';
import { apiJson } from './api';

const ALBUM_ASSIGN_MESSAGE = 'Could not add files to the folder album.';

export function assignFolderAlbum(
    email: string,
    token: string,
    folder: string,
    albumKey: string | undefined,
    mediaKeys: readonly string[]
): AsyncResult<string, ApplicationError> {
    const request: AlbumAssignRequest = {
        email,
        token,
        folder,
        albumKey,
        mediaKeys: [...mediaKeys]
    };

    return apiJson(
        '/api/albums',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request)
        },
        ALBUM_ASSIGN_MESSAGE
    )
        .andThen((value) => schemaResult(AlbumAssignResponseSchema, value, ALBUM_ASSIGN_MESSAGE))
        .map((response) => response.albumKey);
}
