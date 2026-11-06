import { and, asc, eq } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { CreateShareRequest } from '@madkarmaa/phodrive-core/models';
import {
    fileSnapshot,
    folderSnapshot,
    readAccountSnapshot,
    relativeFolder,
    type AccountSnapshot,
    type SnapshotFile
} from '@madkarmaa/phodrive-core/server/photos/shares';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { ServerContext } from '../context';
import { createChunkMetadataStore } from '../chunk-metadata';
import { googleAccount, googleAccountGroupMember } from '../db/schema';
import { AUTH_ERRORS } from '../errors';
import { readGoogleAccount } from '../google';
import type { DraftFile, DraftSource, ShareError } from './repository';

export type ShareSnapshot = {
    sources: DraftSource[];
};

type Member = { id: string; email: string };

function groupMembers(
    context: ServerContext,
    userId: string,
    groupId: string
): AsyncResult<Member[], ShareError> {
    return Ok(undefined).andThenAsync<Member[], ShareError>(async () => {
        try {
            const members = await context.db
                .select({ id: googleAccount.id, email: googleAccount.email })
                .from(googleAccountGroupMember)
                .innerJoin(
                    googleAccount,
                    and(
                        eq(googleAccount.userId, googleAccountGroupMember.userId),
                        eq(googleAccount.id, googleAccountGroupMember.googleAccountId)
                    )
                )
                .where(
                    and(
                        eq(googleAccountGroupMember.userId, userId),
                        eq(googleAccountGroupMember.groupId, groupId)
                    )
                )
                .orderBy(asc(googleAccount.email), asc(googleAccount.id));

            return members.length ? Ok(members) : Err(AUTH_ERRORS.GROUP_MEMBER_INVALID);
        } catch {
            return Err(AUTH_ERRORS.DATABASE_UNAVAILABLE);
        }
    });
}

function sourceFiles(
    snapshotFiles: readonly SnapshotFile[],
    folder: string,
    fileShare = false
): DraftFile[] {
    return snapshotFiles.map((snapshot) => ({
        snapshot,
        relativeFolder: fileShare ? '' : relativeFolder(snapshot, folder)
    }));
}

function selectFiles(
    request: CreateShareRequest,
    snapshot: AccountSnapshot
): Result<SnapshotFile[], ServerError> {
    if (request.kind === 'file')
        return fileSnapshot(snapshot, request.fileId).map((file) => [file]);

    return folderSnapshot(snapshot, request.folder);
}

function readAccountSource(
    context: ServerContext,
    userId: string,
    request: CreateShareRequest,
    accountId: string,
    signal?: AbortSignal
): AsyncResult<DraftSource[], ShareError> {
    return readGoogleAccount(context, userId, accountId).andThenAsync((current) => {
        const snapshot = readAccountSnapshot(
            { email: current.email, token: current.token },
            {
                metadata: createChunkMetadataStore(context.db, {
                    userId,
                    googleAccountId: current.id
                }),
                scope: { key: current.id, coordinator: context.throttle, signal }
            }
        );

        return snapshot
            .andThen((account) => selectFiles(request, account))
            .orElse((error) =>
                request.kind === 'folder' && error.code === SERVER_ERRORS.SHARE_INVALID.code
                    ? Ok([])
                    : Err(error)
            )
            .map((files) =>
                files.length
                    ? [
                          {
                              accountEmail: current.email,
                              files: sourceFiles(
                                  files,
                                  request.kind === 'file' ? '' : request.folder,
                                  request.kind === 'file'
                              )
                          }
                      ]
                    : []
            );
    });
}

function appendSources(
    context: ServerContext,
    userId: string,
    request: CreateShareRequest,
    ids: readonly string[],
    index: number,
    sources: DraftSource[],
    signal?: AbortSignal
): AsyncResult<void, ShareError> {
    return readAccountSource(context, userId, request, ids[index], signal).andThenAsync<
        void,
        ShareError
    >(async (files) => {
        sources.push(...files);

        return index + 1 < ids.length
            ? appendSources(context, userId, request, ids, index + 1, sources, signal)
            : Ok(undefined);
    });
}

function collectSources(
    context: ServerContext,
    userId: string,
    request: CreateShareRequest,
    ids: readonly string[],
    signal?: AbortSignal
): AsyncResult<ShareSnapshot, ShareError> {
    const sources: DraftSource[] = [];

    return appendSources(context, userId, request, ids, 0, sources, signal).andThen(
        (): Result<ShareSnapshot, ShareError> =>
            sources.length ? Ok({ sources }) : Err(SERVER_ERRORS.SHARE_INVALID)
    );
}

export function resolveShareSnapshot(
    context: ServerContext,
    userId: string,
    request: CreateShareRequest,
    signal?: AbortSignal
): AsyncResult<ShareSnapshot, ShareError> {
    const collect = (ids: readonly string[]) =>
        collectSources(context, userId, request, ids, signal);

    if (request.context.kind === 'account')
        return collect([request.kind === 'file' ? request.accountId : request.context.id]);

    const members = groupMembers(context, userId, request.context.id);
    if (request.kind === 'folder')
        return members.andThenAsync((rows) => collect(rows.map((member) => member.id)));

    return members.andThenAsync<ShareSnapshot, ShareError>(async (rows) =>
        rows.some((member) => member.id === request.accountId)
            ? collect([request.accountId])
            : Err(AUTH_ERRORS.GOOGLE_ACCOUNT_NOT_FOUND)
    );
}
