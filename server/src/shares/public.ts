import { and, asc, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { PublicShare } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { ServerContext } from '../context';
import { share, shareFile } from '../db/schema';
import { queried, type ShareError } from './repository';

type ActiveShare = {
    id: string;
    userId: string;
    name: string;
    kind: PublicShare['kind'];
    createdAt: Date;
};

export function findActiveShare(
    context: ServerContext,
    token: string
): AsyncResult<ActiveShare, ShareError> {
    const found = queried(async () => {
        const [row] = await context.db
            .select({
                id: share.id,
                userId: share.userId,
                name: share.name,
                kind: share.kind,
                createdAt: share.createdAt
            })
            .from(share)
            .where(and(eq(share.publicToken, token), eq(share.status, 'active')))
            .limit(1);

        return row;
    });

    return found.andThen((row): Result<ActiveShare, ShareError> =>
        row ? Ok(row) : Err(SERVER_ERRORS.SHARE_NOT_FOUND)
    );
}

export function getPublicShare(
    context: ServerContext,
    token: string
): AsyncResult<PublicShare, ShareError> {
    return findActiveShare(context, token).andThenAsync((row) => {
        const files = queried(() =>
            context.db
                .select({
                    id: shareFile.id,
                    fileHash: shareFile.fileHash,
                    name: shareFile.name,
                    relativeFolder: shareFile.relativeFolder,
                    chunkCount: shareFile.chunkCount,
                    size: shareFile.size
                })
                .from(shareFile)
                .where(eq(shareFile.shareId, row.id))
                .orderBy(asc(shareFile.relativeFolder), asc(shareFile.name))
        );

        return files.map((items) => ({
            name: row.name,
            kind: row.kind,
            createdAt: row.createdAt.toISOString(),
            files: items
        }));
    });
}
