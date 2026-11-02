import { SERVER_ERRORS, type ServerError } from './errors';
import {
    BulkDeleteRequestSchema,
    type BulkDeleteAction,
    type BulkDeleteFile,
    type BulkDeleteRequest
} from '../bulk-delete';
import { FileActionKind } from '../models';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import { readAccountState, type LibraryAccountState } from './photos/library/state';
import { photosFetch, type Fetcher } from './fetcher';

export type ValidatedBulkFile = BulkDeleteFile & { index: number };

export type BulkDeleteInvalidFile = {
    index: number;
    name: string;
    code: ServerError['code'];
    message: string;
};

export type BulkDeleteValidation = {
    files: ValidatedBulkFile[];
    invalid: BulkDeleteInvalidFile[];
};

function validateState(
    files: BulkDeleteRequest['files'],
    state: LibraryAccountState,
    action: BulkDeleteAction
): BulkDeleteValidation {
    const validated: ValidatedBulkFile[] = [];
    const invalid: BulkDeleteInvalidFile[] = [];

    for (const [index, [name, fileHash, fileId, pairs]] of files.entries()) {
        const chunks = pairs.map(([mediaKey, sha1]) => ({ mediaKey, sha1 }));
        let error: ServerError | null = null;
        for (const chunk of chunks) {
            const stored = state.items.get(chunk.mediaKey);
            if (
                !stored ||
                stored.sha1 !== chunk.sha1 ||
                stored.fileHash !== fileHash ||
                stored.fileId !== fileId
            ) {
                error = SERVER_ERRORS.INVALID_FILE_METADATA;
                break;
            }

            if (action === FileActionKind.Delete && stored.trashedAt !== undefined) {
                error = SERVER_ERRORS.NOT_ACTIVE;
                break;
            }

            if (action !== FileActionKind.Delete && stored.trashedAt === undefined) {
                error = SERVER_ERRORS.NOT_TRASHED;
                break;
            }
        }

        if (error) invalid.push({ index, name, code: error.code, message: error.message });
        else validated.push({ index, name, fileHash, fileId, chunks });
    }

    return { files: validated, invalid };
}

export function validateBulkDelete(
    input: BulkDeleteRequest,
    fetcher: Fetcher = photosFetch
): AsyncResult<BulkDeleteValidation, ServerError> {
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
        if (initial.invalid.length === 0 || built) return Ok(initial);

        const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
        const refreshError = refreshed.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (refreshError) return Err(refreshError);

        const next = readAccountState(input.email);
        if (!next) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        return Ok(validateState(parsed.data.files, next, action));
    });
}
