import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { FolderManageAction, type FolderFailure, type FolderManageRequest } from '../manage';
import { FolderPathSchema, type RemoteBmp } from '../models';
import { SERVER_ERRORS, isThrottleError, throttleError, type ServerError } from './errors';
import { photosFetch, type Fetcher } from './fetcher';
import { ensureAccountIndex } from './photos/library/ensure';
import {
    activeChunks,
    filesInFolder,
    folderName,
    folderOccupied,
    folderPathExists,
    indexFiles,
    nameExistsInFolder,
    parentFolder,
    type IndexedFile
} from './photos/library/index-files';
import { withAccountLock } from './photos/library/lock';
import {
    folderSuffix,
    isInFolder,
    joinFolder,
    replacePrefix,
    withListingFolder,
    type LibraryOverrides
} from './photos/library/overrides';
import { updateListingItems } from './photos/library/listing-updates';
import {
    readAccountOverrides,
    readAccountRevision,
    readAccountState,
    writeAccountOverrides
} from './photos/library/state';
import { moveToTrash } from './photos/index';
import { limitWorkers } from './workers';

export type FolderManageResult = {
    items: RemoteBmp[];
    revision: number;
    fileCount: number;
    failed: FolderFailure[];
};

function fileError(name: string): ServerError {
    return {
        ...SERVER_ERRORS.FILE_NAME_EXISTS,
        message: `A file named ${name} already exists in the destination folder.`
    };
}

function folderError(name: string): ServerError {
    return {
        ...SERVER_ERRORS.FOLDER_EXISTS,
        message: `A folder named ${name} already exists here.`
    };
}

function destinationError(): ServerError {
    return {
        ...SERVER_ERRORS.INVALID_FOLDER_DESTINATION,
        message: 'Choose an existing folder.'
    };
}

function emptyResult(revision: number, fileCount: number): FolderManageResult {
    return { items: [], revision, fileCount, failed: [] };
}

function targetFolder(input: FolderManageRequest, files: readonly IndexedFile[]): string | null {
    if (input.action === FolderManageAction.Rename)
        return joinFolder(parentFolder(input.folder), input.name);

    if (input.action === FolderManageAction.MoveContents) return '';

    if (input.action !== FolderManageAction.Move) return null;
    if (input.destination === input.folder || isInFolder(input.destination, input.folder))
        return null;
    if (input.destination && !folderPathExists(files, input.destination)) return null;

    return joinFolder(input.destination, folderName(input.folder));
}

function nextFolder(input: FolderManageRequest, file: IndexedFile, target: string): string {
    if (input.action === FolderManageAction.MoveContents)
        return folderSuffix(file.folder, input.folder);

    return replacePrefix(file.folder, input.folder, target);
}

function collisionError(
    input: FolderManageRequest,
    files: readonly IndexedFile[],
    affected: readonly IndexedFile[],
    target: string
): ServerError | null {
    if (input.action === FolderManageAction.MoveContents) {
        for (const file of affected) {
            const next = nextFolder(input, file, target);
            if (nameExistsInFolder(files, file.name, next, file.fileId))
                return fileError(file.name);
        }

        return null;
    }

    const affectedIds = new Set(affected.map((file) => file.fileId));
    if (folderOccupied(files, target, affectedIds)) return folderError(folderName(target));

    return null;
}

function nextOverrides(
    overrides: LibraryOverrides,
    input: FolderManageRequest,
    affected: readonly IndexedFile[],
    target: string
): LibraryOverrides {
    const fileFolders = { ...overrides.fileFolders };
    for (const file of affected) fileFolders[file.fileId] = nextFolder(input, file, target);

    return {
        ...overrides,
        fileFolders,
        folderPrefixes: [...overrides.folderPrefixes, { from: input.folder, to: target }]
    };
}

function folderFailure(
    file: IndexedFile | undefined,
    chunk: RemoteBmp,
    error: ServerError
): FolderFailure {
    const message = isThrottleError(error)
        ? throttleError(error.retryAfterSeconds, 'manual').message
        : error.message;

    return {
        fileId: file?.fileId ?? chunk.fileId,
        name: file?.name ?? `File ${chunk.fileHash.slice(0, 12)}`,
        message
    };
}

async function trashFolder(
    input: Extract<FolderManageRequest, { action: FolderManageAction.Delete }>,
    affected: readonly IndexedFile[]
): Promise<Result<FolderManageResult, ServerError>> {
    const deletable = affected.filter((file) =>
        file.items.some((item) => item.trashedAt === undefined)
    );
    if (deletable.length === 0) return Ok(emptyResult(readAccountRevision(input.email), 0));

    const chunks = activeChunks(deletable);
    const filesById = new Map(deletable.map((file) => [file.fileId, file]));
    const successes: RemoteBmp[] = [];
    const failures = new Map<string, FolderFailure>();
    const limit = pLimit(limitWorkers(input.workers));
    const now = Date.now();
    await limit.map(chunks, async (chunk) => {
        const removed = await moveToTrash(input.email, input.token, chunk.sha1);
        removed.match({
            Ok: () => {
                successes.push(chunk);
            },
            Err: (error) => {
                const failure = folderFailure(filesById.get(chunk.fileId), chunk, error);
                failures.set(failure.fileId, failure);
            }
        });
    });

    const items = updateListingItems(
        input.email,
        successes.map((item) => ({ ...item, trashedAt: now })),
        now
    );

    return Ok({
        items,
        revision: readAccountRevision(input.email),
        fileCount: deletable.length,
        failed: [...failures.values()]
    });
}

/** Rename, move, flatten, or trash every file under one folder path. */
export function manageFolder(
    input: FolderManageRequest,
    fetcher: Fetcher = photosFetch
): AsyncResult<FolderManageResult, ServerError> {
    return ensureAccountIndex(input.email, input.token, fetcher).andThenAsync(() =>
        withAccountLock(input.email, async () => {
            const state = readAccountState(input.email);
            if (!state) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

            const files = indexFiles(state.items.values());
            const affected = filesInFolder(files, input.folder);
            if (affected.length === 0) return Err(SERVER_ERRORS.FOLDER_NOT_FOUND);
            if (input.action === FolderManageAction.Delete)
                return await trashFolder(input, affected);

            const target = targetFolder(input, files);
            if (target === null) return Err(destinationError());
            if (target === input.folder) return Ok(emptyResult(state.revision, affected.length));
            if (target !== '' && !FolderPathSchema.safeParse(target).success)
                return Err(SERVER_ERRORS.INVALID_FOLDER_PATH);

            const collision = collisionError(input, files, affected, target);
            if (collision) return Err(collision);

            writeAccountOverrides(
                input.email,
                nextOverrides(readAccountOverrides(input.email), input, affected, target)
            );
            const changed = affected.flatMap((file) => {
                const folder = nextFolder(input, file, target);

                return file.items.map((item) => withListingFolder(item, folder));
            });
            const items = updateListingItems(input.email, changed);

            return Ok({
                items,
                revision: readAccountRevision(input.email),
                fileCount: affected.length,
                failed: []
            });
        })
    );
}
