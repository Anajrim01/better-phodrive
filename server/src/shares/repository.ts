import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ShareKind, ShareSummary } from '@madkarmaa/phodrive-core/models';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { SnapshotFile } from '@madkarmaa/phodrive-core/server/photos/shares';
import type { Database } from '../db/client';
import { share, shareChunk, shareFile } from '../db/schema';
import { AUTH_ERRORS, type AuthError } from '../errors';

const INSERT_BATCH_ROWS = 500;

export type ShareError = ServerError | AuthError;
export type ShareRow = typeof share.$inferSelect;

export type DraftFile = {
    snapshot: SnapshotFile;
    relativeFolder: string;
};

export type DraftSource = {
    accountEmail: string;
    files: DraftFile[];
};

type NewShare = {
    requestKey: string;
    requestFingerprint: string;
    kind: ShareKind;
    name: string;
};

export function queried<T>(run: () => Promise<T>): AsyncResult<T, ShareError> {
    return Ok(undefined).andThenAsync<T, ShareError>(async () => {
        try {
            return Ok(await run());
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

export function findShareByRequestKey(
    db: Database,
    userId: string,
    requestKey: string
): AsyncResult<ShareRow | undefined, ShareError> {
    return queried(async () => {
        const [row] = await db
            .select()
            .from(share)
            .where(and(eq(share.userId, userId), eq(share.requestKey, requestKey)))
            .limit(1);

        return row;
    });
}

export function findShareById(
    db: Database,
    userId: string,
    shareId: string
): AsyncResult<ShareRow | undefined, ShareError> {
    return queried(async () => {
        const [row] = await db
            .select()
            .from(share)
            .where(and(eq(share.userId, userId), eq(share.id, shareId)))
            .limit(1);

        return row;
    });
}

export function countShareFiles(db: Database, shareId: string): AsyncResult<number, ShareError> {
    return queried(async () => {
        const rows = await db
            .select({ count: count() })
            .from(shareFile)
            .where(eq(shareFile.shareId, shareId));

        return rows[0]?.count ?? 0;
    });
}

function batches<T>(rows: readonly T[]): T[][] {
    const result: T[][] = [];

    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_ROWS)
        result.push(rows.slice(offset, offset + INSERT_BATCH_ROWS));

    return result;
}

function fileRows(shareId: string, userId: string, sources: readonly DraftSource[]) {
    return sources.flatMap((source) =>
        source.files.map(({ snapshot: { file, size }, relativeFolder }) => ({
            id: randomUUID(),
            shareId,
            userId,
            googleAccountEmail: source.accountEmail,
            fileId: file.fileId,
            fileHash: file.fileHash,
            name: file.name,
            folder: file.folder,
            relativeFolder,
            chunkCount: file.chunks.length,
            size
        }))
    );
}

function chunkRows(shareId: string, userId: string, sources: readonly DraftSource[]) {
    return sources.flatMap((source) =>
        source.files.flatMap(({ snapshot: { file } }) =>
            file.chunks.map((chunk) => ({
                shareId,
                userId,
                googleAccountEmail: source.accountEmail,
                fileId: file.fileId,
                chunkIndex: chunk.chunkIndex,
                mediaKey: chunk.mediaKey,
                sha1: chunk.sha1,
                payloadSize: chunk.size,
                isLast: chunk.isLast
            }))
        )
    );
}

export function insertShare(
    db: Database,
    userId: string,
    input: NewShare,
    sources: readonly DraftSource[]
): AsyncResult<ShareRow, ShareError> {
    return queried(() =>
        db.transaction(async (tx): Promise<Result<ShareRow, ShareError>> => {
            const [created] = await tx
                .insert(share)
                .values({
                    ...input,
                    userId,
                    status: 'active',
                    publicToken: randomBytes(24).toString('base64url')
                })
                .onConflictDoNothing({ target: [share.userId, share.requestKey] })
                .returning();
            if (!created) {
                const [winner] = await tx
                    .select()
                    .from(share)
                    .where(and(eq(share.userId, userId), eq(share.requestKey, input.requestKey)));

                return winner ? Ok(winner) : Err(SERVER_ERRORS.SHARE_NOT_FOUND);
            }

            for (const batch of batches(fileRows(created.id, userId, sources)))
                await tx.insert(shareFile).values(batch);
            for (const batch of batches(chunkRows(created.id, userId, sources)))
                await tx.insert(shareChunk).values(batch);

            return Ok(created);
        })
    ).andThen((result) => result);
}

export function listShares(db: Database, userId: string): AsyncResult<ShareSummary[], ShareError> {
    return queried(async () => {
        const rows = await db
            .select()
            .from(share)
            .where(and(eq(share.userId, userId), eq(share.status, 'active')))
            .orderBy(desc(share.createdAt));
        if (!rows.length) return [];

        const counts = await db
            .select({ shareId: shareFile.shareId, count: count() })
            .from(shareFile)
            .where(
                inArray(
                    shareFile.shareId,
                    rows.map((row) => row.id)
                )
            )
            .groupBy(shareFile.shareId);
        const byShare = new Map(counts.map((entry) => [entry.shareId, entry.count]));

        return rows.map((row) => summary(row, byShare.get(row.id) ?? 0));
    });
}

export function summary(row: ShareRow, fileCount: number): ShareSummary {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        status: row.status,
        fileCount,
        createdAt: row.createdAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        publicPath: `/s/${row.publicToken}`
    };
}
