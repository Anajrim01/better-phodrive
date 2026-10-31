import { assignFolderAlbum } from '@madkarmaa/phodrive-core/server/photos';
import { AlbumAssignRequestSchema } from '@madkarmaa/phodrive-core/models';
import { errorResponse, jsonResponse, readJsonRequest } from '#server/api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request }) =>
    readJsonRequest(request, AlbumAssignRequestSchema, 'Invalid request')
        .andThenAsync((input) =>
            assignFolderAlbum(
                input.email,
                input.token,
                input.folder,
                input.albumKey,
                input.mediaKeys
            )
        )
        .match({ Ok: (albumKey) => jsonResponse({ albumKey }), Err: errorResponse });
