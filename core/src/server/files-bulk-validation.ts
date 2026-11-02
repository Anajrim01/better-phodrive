import { SERVER_ERRORS, type ServerError } from './errors';
import {
    BulkDeleteRequestSchema,
    type BulkDeleteAction,
    type BulkDeleteFile,
    type BulkDeleteRequest
} from '../bulk-delete';
import { FileActionKind } from '../models';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import { readAccountState, type LibraryAccountState } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';

function validateState(
    files: BulkDeleteRequest['files'],
    state: LibraryAccountState,
    action: BulkDeleteAction
): Result<BulkDeleteFile[], ServerError> {
    const validated: BulkDeleteFile[] = [];

    for (const [name, fileHash, fileId, pairs] of files) {
        const chunks = pairs.map(([mediaKey, sha1]) => ({ mediaKey, sha1 }));

        for (const chunk of chunks) {
            const stored = state.items.get(chunk.mediaKey);
            if (
                !stored ||
                stored.sha1 !== chunk.sha1 ||
                stored.fileHash !== fileHash ||
                stored.fileId !== fileId
            )
                return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

            if (action !== FileActionKind.Delete && stored.trashedAt === undefined)
                return Err(SERVER_ERRORS.NOT_TRASHED);
        }

        validated.push({ name, fileHash, fileId, chunks });
    }

    return Ok(validated);
}

export function validateBulkDelete(
    input: BulkDeleteRequest,
    fetcher: Fetcher = photosFetch
): AsyncResult<BulkDeleteFile[], ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const parsed = BulkDeleteRequestSchema.safeParse(input);
        if (!parsed.success) return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

        const action = parsed.data.action;
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

        const initial = validateState(parsed.data.files, state, action);
        if (initial.isOk() || built) return initial;

        const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
        const refreshError = refreshed.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (refreshError) return Err(refreshError);

        const next = readAccountState(input.email);
        if (!next) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        return validateState(parsed.data.files, next, action);
    });
}
