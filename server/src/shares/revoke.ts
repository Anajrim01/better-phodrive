import { and, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ShareSummary } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { ServerContext } from '../context';
import { share } from '../db/schema';
import {
    countShareFiles,
    findShareById,
    queried,
    summary,
    type ShareError,
    type ShareRow
} from './repository';

// Already-issued capabilities remain valid until their expiry.
export function revokeShare(
    context: ServerContext,
    userId: string,
    shareId: string
): AsyncResult<ShareSummary, ShareError> {
    const revoked = queried(() =>
        context.db
            .update(share)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(and(eq(share.id, shareId), eq(share.userId, userId), eq(share.status, 'active')))
            .returning()
    );

    return revoked
        .andThenAsync<ShareRow | undefined, ShareError>(async ([row]) =>
            row ? Ok(row) : findShareById(context.db, userId, shareId)
        )
        .andThen((row): Result<ShareRow, ShareError> =>
            row ? Ok(row) : Err(SERVER_ERRORS.SHARE_NOT_FOUND)
        )
        .andThenAsync((row) =>
            countShareFiles(context.db, row.id).map((fileCount) => summary(row, fileCount))
        );
}
