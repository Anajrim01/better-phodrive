import { Err, Ok, type AsyncResult } from 'results-ts';
import { FileManageAction, type FileManageRequest } from '../manage';
import type { RemoteBmp } from '../models';
import { SERVER_ERRORS, type ServerError } from './errors';
import { photosFetch, type Fetcher } from './fetcher';
import { verifyManageAccount } from './manage-auth';
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import {
    fileById,
    folderPathExists,
    indexFiles,
    nameExistsInFolder
} from './photos/library/index-files';
import { updateListingItems } from './photos/library/listing-updates';
import { withAccountLock } from './photos/library/lock';
import {
    withListingName,
    withMovedListingFolder,
    type LibraryOverrides
} from './photos/library/overrides';
import {
    readAccountOverrides,
    readAccountRevision,
    readAccountState,
    writeAccountOverrides
} from './photos/library/state';

export type ManageResult = {
    items: RemoteBmp[];
    revision: number;
};

function renameError(name: string): ServerError {
    return {
        ...SERVER_ERRORS.FILE_NAME_EXISTS,
        message: `A file named ${name} already exists in this folder.`
    };
}

function destinationError(): ServerError {
    return {
        ...SERVER_ERRORS.INVALID_FOLDER_DESTINATION,
        message: 'Choose an existing folder.'
    };
}

function renamedOverrides(
    overrides: LibraryOverrides,
    fileId: string,
    name: string
): LibraryOverrides {
    return { ...overrides, fileNames: { ...overrides.fileNames, [fileId]: name } };
}

function movedOverrides(
    overrides: LibraryOverrides,
    fileId: string,
    folder: string
): LibraryOverrides {
    return { ...overrides, fileFolders: { ...overrides.fileFolders, [fileId]: folder } };
}

/** Rename or move one file's listing metadata without touching its chunk headers. */
export function manageFile(
    input: FileManageRequest,
    fetcher: Fetcher = photosFetch
): AsyncResult<ManageResult, ServerError> {
    return verifyManageAccount(input.email, input.token, fetcher)
        .andThenAsync(() => ensureAccountIndex(input.email, input.token, fetcher))
        .andThenAsync(() => manageIndexedFile(input))
        .orElseAsync(async (error) => {
            if (error.code !== 'FILE_NOT_FOUND') return Err(error);

            const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
            const recovered = await refreshed.andThenAsync(() => manageIndexedFile(input));

            // The refreshed index may hold changes the client has not seen yet.
            return recovered.map((result) => ({ ...result, revision: 0 }));
        });
}

function manageIndexedFile(input: FileManageRequest): AsyncResult<ManageResult, ServerError> {
    return Ok(undefined).andThenAsync(async () =>
        withAccountLock(input.email, async () => {
            const state = readAccountState(input.email);
            if (!state) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

            const files = indexFiles(state.items.values());
            const file = fileById(files, input.fileId);
            if (!file) return Err(SERVER_ERRORS.FILE_NOT_FOUND);

            if (input.action === FileManageAction.Rename) {
                if (input.name === file.name) return Ok({ items: [], revision: state.revision });
                if (nameExistsInFolder(files, input.name, file.folder, file.fileId))
                    return Err(renameError(input.name));

                writeAccountOverrides(
                    input.email,
                    renamedOverrides(readAccountOverrides(input.email), file.fileId, input.name)
                );
                const items = updateListingItems(
                    input.email,
                    file.items.map((item) => withListingName(item, input.name))
                );

                return Ok({ items, revision: readAccountRevision(input.email) });
            }

            if (input.folder === file.folder) return Ok({ items: [], revision: state.revision });
            if (input.folder && !folderPathExists(files, input.folder))
                return Err(destinationError());
            if (nameExistsInFolder(files, file.name, input.folder, file.fileId))
                return Err(renameError(file.name));

            writeAccountOverrides(
                input.email,
                movedOverrides(readAccountOverrides(input.email), file.fileId, input.folder)
            );
            const items = updateListingItems(
                input.email,
                file.items.map((item) => withMovedListingFolder(item, input.folder))
            );

            return Ok({ items, revision: readAccountRevision(input.email) });
        })
    );
}
