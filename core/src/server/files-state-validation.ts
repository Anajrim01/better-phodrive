import { SERVER_ERRORS, type ServerError } from './errors';
import type { FileRequest, RemoteBmp } from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import { readAccountState, type LibraryAccountState } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';

function validateStoredChunks(
    input: FileRequest,
    chunks: readonly RemoteBmp[],
    state: LibraryAccountState
): Result<void, ServerError> {
    for (const chunk of chunks) {
        const stored = state.items.get(chunk.mediaKey);
        if (
            !stored ||
            stored.sha1 !== chunk.sha1 ||
            stored.fileHash !== input.fileHash ||
            stored.fileId !== input.fileId
        )
            return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

        if (stored.trashedAt === undefined) return Err(SERVER_ERRORS.NOT_TRASHED);
    }

    return Ok(undefined);
}

export function validateTrashedFileState(
    input: FileRequest,
    chunks: readonly RemoteBmp[],
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const built = !readAccountState(input.email);
        if (built) {
            const ensured = await ensureAccountIndex(input.email, input.token, fetcher);
            const ensureError = ensured.match<ServerError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            if (ensureError) return Err(ensureError);
        }

        const state = readAccountState(input.email);
        if (!state) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        const initial = validateStoredChunks(input, chunks, state);
        if (initial.isOk() || built) return initial;

        const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
        const refreshError = refreshed.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (refreshError) return Err(refreshError);

        const next = readAccountState(input.email);
        if (!next) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        return validateStoredChunks(input, chunks, next);
    });
}
