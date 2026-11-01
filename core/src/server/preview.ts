import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { FileNameSchema, type RemoteBmp } from '../models';
import {
    MAX_IMAGE_PREVIEW_BYTES,
    PreviewMode,
    PreviewUnavailableReason,
    previewModeFor,
    type FilePreviewRequest,
    type PreviewResult
} from '../preview';
import { openChunk } from './chunk-open';
import { SERVER_ERRORS, type ServerError, type ThrottleMode } from './errors';
import { readImage } from './preview/image';
import { readText } from './preview/text';

export type { PreviewResult } from '../preview';

function unavailable(reason: PreviewUnavailableReason): Result<PreviewResult, ServerError> {
    return Ok({ kind: 'unavailable', reason });
}

function validateChunks(input: FilePreviewRequest): Result<RemoteBmp[], ServerError> {
    const chunks = input.chunks.toSorted((first, second) => first.chunkIndex - second.chunkIndex);
    if (
        !FileNameSchema.safeParse(input.name).success ||
        chunks.some(
            (chunk) => chunk.fileHash !== input.fileHash || chunk.fileId !== input.fileId
        ) ||
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name)
        )
    )
        return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    return Ok(chunks);
}

/** Read chunk zero only; multi-chunk images fall back without spending a Google request. */
export function previewFile(
    input: FilePreviewRequest,
    signal?: AbortSignal,
    throttle: ThrottleMode = 'auto'
): AsyncResult<PreviewResult, ServerError> {
    const mode = previewModeFor(input.name);
    if (mode === null || mode !== input.mode)
        return Ok(undefined).andThenAsync(async () =>
            unavailable(PreviewUnavailableReason.Unsupported)
        );

    return validateChunks(input).andThenAsync(async (chunks) => {
        const first = chunks[0];
        if (mode === PreviewMode.Image) {
            if (chunks.length > 1) return unavailable(PreviewUnavailableReason.MultiChunk);
            if (first.size > MAX_IMAGE_PREVIEW_BYTES)
                return unavailable(PreviewUnavailableReason.TooLarge);
        }

        return openChunk(input, first, signal, throttle).andThenAsync(async (reader) => {
            const read =
                mode === PreviewMode.Image
                    ? await readImage(reader, first)
                    : await readText(reader, first, chunks.length > 1);
            const closed = await reader.close();

            return closed.andThen<PreviewResult, ServerError>(() => read);
        });
    });
}
