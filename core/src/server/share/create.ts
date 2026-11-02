import { SERVER_ERRORS, type ServerError } from '../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { photosFetch, type Fetcher } from '../fetcher';
import { createShareAlbum, removeShareAlbum } from '../photos/albums';
import { createEnvelope, deleteEnvelope } from './envelope';
import {
    ShareCreateRequestSchema,
    type ShareCreateRequest,
    type ShareCreateResponse
} from '../../share-models';
import { LINK_STATE_DISABLED } from './requests';
import { enableShareLink, updateLinkState } from './link';
import { buildShareUrl, manifestFile } from './manifest';
import type { PollOptions } from './public';

const DEFAULT_POLL: PollOptions = { attempts: 30, delayMs: 1000 };
const DEFAULT_RETRY_DELAY_MS = 2000;

export type ShareCreateOptions = {
    poll?: Partial<PollOptions>;
    retryDelayMs?: number;
    now?: () => number;
};

export function createShare(
    input: ShareCreateRequest,
    fetcher: Fetcher = photosFetch,
    options: ShareCreateOptions = {}
): AsyncResult<ShareCreateResponse, ServerError> {
    const parsed = ShareCreateRequestSchema.safeParse(input);
    if (!parsed.success)
        return Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Invalid share request' } as const)
        );

    return Ok(undefined).andThenAsync(async () => {
        const request = parsed.data;
        const poll = { ...DEFAULT_POLL, ...options.poll };
        let albumKey = request.existing?.albumKey;
        let createdAlbum = false;

        if (albumKey === undefined) {
            const album = await createShareAlbum(
                request.email,
                request.token,
                request.name,
                mediaKeys(request),
                fetcher
            );
            if (album.isErr()) return album;

            albumKey = album.unwrap();
            createdAlbum = true;
        }

        let envelopeKey = request.existing?.envelopeKey;
        let createdEnvelope = false;
        if (envelopeKey === undefined) {
            const envelope = await createEnvelope(
                request.email,
                request.token,
                albumKey,
                request.name,
                fetcher
            );
            if (envelope.isErr()) {
                if (createdAlbum)
                    await removeShareAlbum(request.email, request.token, albumKey, fetcher);

                return envelope;
            }

            envelopeKey = envelope.unwrap();
            createdEnvelope = true;
        }

        const link = await enableShareLink(
            request.email,
            request.token,
            envelopeKey,
            request.existing,
            fetcher,
            { poll, retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS }
        );
        if (link.isErr()) {
            if (createdEnvelope || createdAlbum)
                await cleanup(
                    request,
                    envelopeKey,
                    albumKey,
                    createdEnvelope,
                    createdAlbum,
                    fetcher
                );

            return link;
        }

        const manifest = {
            v: 1 as const,
            album: link.unwrap().canonicalUrl,
            files: request.files.map(manifestFile)
        };
        const shareUrl = buildShareUrl(manifest);
        if (shareUrl.isErr()) {
            await cleanup(request, envelopeKey, albumKey, createdEnvelope, createdAlbum, fetcher);

            return shareUrl;
        }

        return Ok({
            record: {
                name: request.name,
                envelopeKey,
                albumKey,
                shortUrl: link.unwrap().shortUrl,
                albumUrl: link.unwrap().canonicalUrl,
                authKey: link.unwrap().authKey,
                shareUrl: shareUrl.unwrap(),
                createdAt: (options.now ?? Date.now)()
            },
            manifest
        });
    });
}

function mediaKeys(request: ShareCreateRequest): string[] {
    return request.files.flatMap((file) => file.chunks.map((chunk) => chunk.mediaKey));
}

async function cleanup(
    request: ShareCreateRequest,
    envelopeKey: string,
    albumKey: string,
    createdEnvelope: boolean,
    createdAlbum: boolean,
    fetcher: Fetcher
): Promise<void> {
    await updateLinkState(request.email, request.token, envelopeKey, LINK_STATE_DISABLED, fetcher);

    if (createdEnvelope) await deleteEnvelope(request.email, request.token, envelopeKey, fetcher);
    if (createdAlbum) await removeShareAlbum(request.email, request.token, albumKey, fetcher);
}
