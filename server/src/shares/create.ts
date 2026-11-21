import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { CreateShareRequest, ShareSummary } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { ServerContext } from '../context';
import {
    countShareFiles,
    findShareByRequestKey,
    insertShare,
    summary,
    type ShareError,
    type ShareRow
} from './repository';
import { resolveShareSnapshot } from './snapshot';
import { checkSnapshotLimits } from './limits';

export type ShareServiceOptions = {
    resolveSnapshot?: typeof resolveShareSnapshot;
};

function requestFingerprint(request: CreateShareRequest): string {
    return JSON.stringify([
        request.kind,
        request.name,
        request.context.kind,
        request.context.id,
        request.kind === 'file' ? request.accountId : '',
        request.kind === 'file' ? request.fileId : request.folder
    ]);
}

function checkTarget(request: CreateShareRequest): Result<void, ShareError> {
    return request.kind === 'file' &&
        request.context.kind === 'account' &&
        request.accountId !== request.context.id
        ? Err(SERVER_ERRORS.SHARE_INVALID)
        : Ok(undefined);
}

function matchingRequest(row: ShareRow, fingerprint: string): Result<ShareRow, ShareError> {
    return row.requestFingerprint === fingerprint ? Ok(row) : Err(SERVER_ERRORS.SHARE_INVALID);
}

export function createShare(
    context: ServerContext,
    userId: string,
    request: CreateShareRequest,
    options: ShareServiceOptions = {},
    signal?: AbortSignal
): AsyncResult<ShareSummary, ShareError> {
    const resolveSnapshot = options.resolveSnapshot ?? resolveShareSnapshot;
    const fingerprint = requestFingerprint(request);
    const newShare = {
        requestKey: request.requestKey,
        requestFingerprint: fingerprint,
        kind: request.kind,
        name: request.name
    };

    const insertSnapshot = () =>
        resolveSnapshot(context, userId, request, signal)
            .andThen((snapshot) =>
                checkSnapshotLimits(request.name, snapshot.sources).map(() => snapshot)
            )
            .andThenAsync(({ sources }) => insertShare(context.db, userId, newShare, sources));

    return checkTarget(request)
        .andThenAsync(() => findShareByRequestKey(context.db, userId, request.requestKey))
        .andThenAsync<ShareRow, ShareError>(async (existing) =>
            existing ? Ok(existing) : insertSnapshot()
        )
        .andThen((row) => matchingRequest(row, fingerprint))
        .andThenAsync((row) =>
            countShareFiles(context.db, row.id).map((fileCount) => summary(row, fileCount))
        );
}
