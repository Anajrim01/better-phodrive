import { Err, Ok, type AsyncResult } from 'results-ts';
import {
    BulkDeleteRequestSchema,
    type BulkDeleteChunk,
    type BulkDeleteRequest
} from '../bulk-delete';
import { SERVER_ERRORS, type ServerError } from './errors';
import { photosFetch, type Fetcher } from './fetcher';
import { ensureAccountIndex, refreshAccountIndex } from './photos/library/ensure';
import { readAccountState, type LibraryAccountState } from './photos/library/state';

export type ValidatedBulkFile = {
    index: number;
    name: string;
    fileHash: string;
    fileId: string;
    chunks: BulkDeleteChunk[];
};

export type BulkDeleteInvalidFile = { index: number; name: string; error: string };

export type BulkDeleteValidation = {
    files: ValidatedBulkFile[];
    invalid: BulkDeleteInvalidFile[];
};

function validateState(
    files: BulkDeleteRequest['files'],
    state: LibraryAccountState
): BulkDeleteValidation {
    const validated: ValidatedBulkFile[] = [];
    const invalid: BulkDeleteInvalidFile[] = [];

    for (const [index, [name, fileHash, fileId, pairs]] of files.entries()) {
        const chunks = pairs.map(([mediaKey, sha1]) => ({ mediaKey, sha1 }));
        const valid = chunks.every((chunk) => {
            const stored = state.items.get(chunk.mediaKey);

            return (
                stored !== undefined &&
                stored.sha1 === chunk.sha1 &&
                stored.fileHash === fileHash &&
                stored.fileId === fileId
            );
        });

        if (valid) validated.push({ index, name, fileHash, fileId, chunks });
        else
            invalid.push({
                index,
                name,
                error: SERVER_ERRORS.INVALID_FILE_METADATA.message
            });
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

        const initial = validateState(parsed.data.files, state);
        if (initial.invalid.length === 0 || built) return Ok(initial);

        const refreshed = await refreshAccountIndex(input.email, input.token, fetcher);
        const refreshError = refreshed.match<ServerError | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (refreshError) return Err(refreshError);

        const next = readAccountState(input.email);
        if (!next) return Err(SERVER_ERRORS.LIBRARY_STATE_REQUIRED);

        return Ok(validateState(parsed.data.files, next));
    });
}
