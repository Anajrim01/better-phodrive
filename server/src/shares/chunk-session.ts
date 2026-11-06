import { and, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ShareChunkSession } from '@madkarmaa/phodrive-core/models';
import { splitBmpByteLength, splitHeaderByteLength } from '@madkarmaa/phodrive-core/bmp/format';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { resolveDownloadUrl } from '@madkarmaa/phodrive-core/server/photos';
import type { ServerContext } from '../context';
import { share, shareChunk, shareFile } from '../db/schema';
import type { ShareConfig } from '../environment';
import { readGoogleAccountByEmail } from '../google';
import { SHARE_CAPABILITY_TTL_MS, encodeCapability } from './capability';
import { findActiveShare } from './public';
import { queried, type ShareError } from './repository';
import { withIssuanceLimit } from './issuance';

const MAX_CHUNK_INDEX = 2_147_483_647;

export type PublicShareOptions = {
    prepareUrl?: typeof resolveDownloadUrl;
    now?: () => number;
    signal?: AbortSignal;
};

type StoredChunk = {
    shareId: string;
    userId: string;
    publicFileId: string;
    googleAccountEmail: string;
    fileId: string;
    fileHash: string;
    name: string;
    folder: string;
    chunkIndex: number;
    mediaKey: string;
    sha1: string;
    payloadSize: number;
    isLast: boolean;
};

type BmpLayout = { prefixOffset: number; totalSize: number };

function loadChunk(
    context: ServerContext,
    token: string,
    publicFileId: string,
    chunkIndex: number
): AsyncResult<StoredChunk, ShareError> {
    return findActiveShare(context, token).andThenAsync((row) => {
        const found = queried(async () => {
            const [stored] = await context.db
                .select({
                    googleAccountEmail: shareFile.googleAccountEmail,
                    fileId: shareFile.fileId,
                    fileHash: shareFile.fileHash,
                    name: shareFile.name,
                    folder: shareFile.folder,
                    mediaKey: shareChunk.mediaKey,
                    sha1: shareChunk.sha1,
                    payloadSize: shareChunk.payloadSize,
                    isLast: shareChunk.isLast
                })
                .from(shareFile)
                .innerJoin(
                    shareChunk,
                    and(
                        eq(shareChunk.shareId, shareFile.shareId),
                        eq(shareChunk.userId, shareFile.userId),
                        eq(shareChunk.googleAccountEmail, shareFile.googleAccountEmail),
                        eq(shareChunk.fileId, shareFile.fileId)
                    )
                )
                .where(
                    and(
                        eq(shareFile.shareId, row.id),
                        eq(shareFile.id, publicFileId),
                        eq(shareChunk.chunkIndex, chunkIndex)
                    )
                )
                .limit(1);

            return stored;
        });

        return found.andThen((stored): Result<StoredChunk, ShareError> =>
            stored
                ? Ok({
                      ...stored,
                      shareId: row.id,
                      userId: row.userId,
                      publicFileId,
                      chunkIndex
                  })
                : Err(SERVER_ERRORS.SHARE_FILE_NOT_FOUND)
        );
    });
}

function bmpLayout(chunk: StoredChunk): Result<BmpLayout, ShareError> {
    const first = chunk.chunkIndex === 0;
    const header = {
        fileHash: chunk.fileHash,
        fileId: chunk.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: chunk.isLast ? (1 as const) : (0 as const),
        payloadSize: chunk.payloadSize,
        ...(first ? { fileName: chunk.name } : {}),
        ...(first && chunk.folder ? { folder: chunk.folder } : {})
    };

    return splitHeaderByteLength(header)
        .andThen((prefixOffset) =>
            splitBmpByteLength(header).map((totalSize) => ({ prefixOffset, totalSize }))
        )
        .mapErr((): ShareError => SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);
}

function resolveMediaUrl(
    context: ServerContext,
    chunk: StoredChunk,
    options: PublicShareOptions
): AsyncResult<URL, ShareError> {
    const prepare = options.prepareUrl ?? resolveDownloadUrl;
    const { signal } = options;

    return readGoogleAccountByEmail(context, chunk.userId, chunk.googleAccountEmail)
        .mapErr((error): ShareError =>
            error.code === 'GOOGLE_ACCOUNT_NOT_FOUND'
                ? SERVER_ERRORS.SHARE_ACCOUNT_DISCONNECTED
                : SERVER_ERRORS.SHARE_MEDIA_UNAVAILABLE
        )
        .andThenAsync((account) =>
            withIssuanceLimit(context, account.id, () =>
                prepare(
                    account.email,
                    account.token,
                    chunk.mediaKey,
                    chunk.sha1,
                    undefined,
                    signal,
                    {
                        key: account.id,
                        coordinator: context.throttle,
                        signal
                    }
                ).mapErr((error): ShareError =>
                    error.code === 'THROTTLED' ? error : SERVER_ERRORS.SHARE_MEDIA_UNAVAILABLE
                )
            )
        );
}

// FOR SHARE makes revoke's UPDATE wait, while concurrent issuances for the share still proceed.
function issueIfActive(
    context: ServerContext,
    sharing: ShareConfig,
    chunk: StoredChunk,
    layout: BmpLayout,
    media: URL,
    now: number
): AsyncResult<ShareChunkSession, ShareError> {
    const expirySeconds = Math.floor((now + SHARE_CAPABILITY_TTL_MS) / 1000);
    const capability = queried(() =>
        context.db.transaction(async (tx) => {
            const [row] = await tx
                .select({ id: share.id })
                .from(share)
                .where(and(eq(share.id, chunk.shareId), eq(share.status, 'active')))
                .limit(1)
                .for('share');

            return row
                ? encodeCapability(
                      {
                          v: 1,
                          s: chunk.shareId,
                          f: chunk.publicFileId,
                          c: chunk.chunkIndex,
                          u: media.href,
                          o: layout.prefixOffset,
                          p: chunk.payloadSize,
                          n: layout.totalSize,
                          e: expirySeconds
                      },
                      sharing.capabilityKey
                  )
                : null;
        })
    );

    return capability.andThen((issued): Result<ShareChunkSession, ShareError> =>
        issued
            ? Ok({
                  url: `${sharing.edgeUrl}/api/bytes`,
                  capability: issued,
                  expiresAt: new Date(expirySeconds * 1000).toISOString(),
                  chunk: { index: chunk.chunkIndex, size: chunk.payloadSize, isLast: chunk.isLast }
              })
            : Err(SERVER_ERRORS.SHARE_NOT_FOUND)
    );
}

function validRequest(context: ServerContext, chunkIndex: number): Result<ShareConfig, ShareError> {
    if (!context.env.sharing) return Err(SERVER_ERRORS.SHARE_DISABLED);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_INDEX)
        return Err(SERVER_ERRORS.SHARE_FILE_NOT_FOUND);

    return Ok(context.env.sharing);
}

export function issueShareChunk(
    context: ServerContext,
    token: string,
    publicFileId: string,
    chunkIndex: number,
    options: PublicShareOptions = {}
): AsyncResult<ShareChunkSession, ShareError> {
    const planned = validRequest(context, chunkIndex).andThenAsync((sharing) =>
        loadChunk(context, token, publicFileId, chunkIndex).andThen((chunk) =>
            bmpLayout(chunk).map((layout) => ({ sharing, chunk, layout }))
        )
    );

    return planned.andThenAsync(({ sharing, chunk, layout }) =>
        resolveMediaUrl(context, chunk, options).andThenAsync((media) =>
            issueIfActive(context, sharing, chunk, layout, media, options.now?.() ?? Date.now())
        )
    );
}
