import {
    ChunkFormat,
    ChunkReferenceSchema,
    FileActionKind,
    FileActionRequestSchema,
    LibraryPageRequestSchema,
    ProcessingMode
} from '@madkarmaa/phodrive-core/models';
import { deleteFile, downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { fileUploadStream, receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { uploadStream } from '@madkarmaa/phodrive-core/server/upload/stream';
import { Hono } from 'hono';
import { errorResponse, jsonResponse, readJsonRequest } from '../api';
import type { ServerContext } from '../context';
import { requireGoogleAccount, requireUser, type ApiEnv } from '../middleware';
import { createChunkMetadataStore } from '../chunk-metadata';

function relayedChunk(response: Response): Response {
    const headers = new Headers({
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store'
    });
    const length = response.headers.get('content-length');
    if (length) headers.set('content-length', length);

    return new Response(response.body, { headers });
}

/** Google Photos routes act for the signed-in user with the token stored on the server. */
export function driveRoutes(context: ServerContext) {
    const signedIn = requireUser(context);
    const connected = requireGoogleAccount(context);

    return new Hono<ApiEnv>()
        .post('/library', signedIn, connected, (c) => {
            const account = c.get('account');
            const metadata = createChunkMetadataStore(context.db, {
                userId: c.get('user').id,
                googleAccountId: account.id
            });

            return readJsonRequest(c.req.raw, LibraryPageRequestSchema, 'Invalid request')
                .andThenAsync((input) =>
                    listBmps(
                        account.email,
                        account.token,
                        input.pageToken ?? '',
                        undefined,
                        metadata
                    ).map((page) => ({
                        ...page,
                        items: page.items.map((item) => ({ ...item, accountId: account.id }))
                    }))
                )
                .match({ Ok: jsonResponse, Err: errorResponse });
        })
        .post('/files', signedIn, connected, (c) => {
            const account = c.get('account');

            return readJsonRequest(c.req.raw, FileActionRequestSchema, 'Invalid request')
                .andThenAsync(async (input) => {
                    if (input.action === FileActionKind.Download)
                        return downloadFile({ ...input, ...account }, c.req.raw.signal);

                    // Delete moves media to Google Photos trash, where it can be restored.
                    return deleteFile({ ...input, ...account }).map(jsonResponse);
                })
                .match({ Ok: (response) => response, Err: errorResponse });
        })
        .post('/upload', signedIn, connected, (c) => {
            const account = c.get('account');
            const metadata = createChunkMetadataStore(context.db, {
                userId: c.get('user').id,
                googleAccountId: account.id
            });

            // Browsers send finished chunks to relay, or whole files for the server to process.
            if (context.env.PHODRIVE_PROCESSING === ProcessingMode.Browser)
                return receiveUpload(c.req.raw, account, ChunkFormat.Bmp).match({
                    Ok: (input) => uploadStream(input, metadata, account.id, context.throttle),
                    Err: errorResponse
                });

            return receiveFileUpload(c.req.raw).match({
                Ok: (received) =>
                    fileUploadStream(
                        received,
                        account,
                        undefined,
                        metadata,
                        account.id,
                        context.throttle
                    ),
                Err: errorResponse
            });
        })
        .post('/chunk', signedIn, connected, (c) => {
            const { email, token } = c.get('account');

            // Relays one stored BMP unchanged for the browser to verify and decode.
            return readJsonRequest(c.req.raw, ChunkReferenceSchema, 'Invalid request')
                .andThenAsync(({ mediaKey, sha1 }) =>
                    downloadBmp(email, token, mediaKey, sha1, undefined, c.req.raw.signal)
                )
                .match({ Ok: relayedChunk, Err: errorResponse });
        });
}
