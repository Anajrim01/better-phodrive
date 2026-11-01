import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import {
    deleteRoute,
    downloadRoute,
    restoreRoute,
    type RouteMember
} from '@madkarmaa/phodrive-core/groups';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    deleteFile,
    deleteForeverFile,
    downloadFile,
    restoreFile,
    saveDownloadedFile
} from '#browser/files';

export type FileActionDeps = {
    account: () => { email: string; token: string | undefined };
    groupMode: () => boolean;
    routeMembers: () => readonly RouteMember[];
    workers: () => number;
    onTrashed: (item: FileGroup, chunk: UploadedChunk) => void;
    onRestored: (item: FileGroup, chunk: UploadedChunk) => void;
    onRemoved: (item: FileGroup, chunk: UploadedChunk) => void;
};

function accountToken(item: FileGroup, deps: FileActionDeps): Result<string, ApplicationError> {
    const { email, token } = deps.account();
    if (item.email !== email || !token)
        return Err({
            code: 'REQUEST_FAILED',
            message: 'Select the connected account for this file before continuing.'
        } as const);

    return Ok(token);
}

export function resolveFileToken(
    item: FileGroup,
    action: FileActionKind,
    deps: FileActionDeps
): Result<string, ApplicationError> {
    if (!deps.groupMode()) return accountToken(item, deps);

    const members = deps.routeMembers();
    const routed =
        action === FileActionKind.Download
            ? downloadRoute(item, members)
            : action === FileActionKind.Restore
              ? restoreRoute(item, members)
              : deleteRoute(item, members);

    return routed.map((route) => route.token);
}

export function resolveMoveToken(
    item: FileGroup,
    deps: FileActionDeps
): Result<string, ApplicationError> {
    if (!deps.groupMode()) return accountToken(item, deps);

    const member = deps
        .routeMembers()
        .find((current) => current.email.toLowerCase() === item.email.toLowerCase());
    if (!member)
        return Err({
            code: 'OWNER_NOT_IN_GROUP',
            message: `${item.email} is not connected.`
        } as const);

    return Ok(member.token);
}

export function applyFileAction(
    item: FileGroup,
    action: FileActionKind,
    token: string,
    deps: FileActionDeps
): AsyncResult<void, ApplicationError> {
    if (action === FileActionKind.Delete)
        return deleteFile(item, token, (chunk) => deps.onTrashed(item, chunk), deps.workers());

    if (action === FileActionKind.Restore)
        return restoreFile(item, token, (chunk) => deps.onRestored(item, chunk));

    if (action === FileActionKind.DeleteForever)
        return deleteForeverFile(
            item,
            token,
            (chunk) => deps.onRemoved(item, chunk),
            deps.workers()
        );

    return downloadFile(item, token).andThen((file) => saveDownloadedFile(file, item.name));
}
