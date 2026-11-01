import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileRequest, RemoteBmp, SplitHeader } from '../models';
import { SPLIT_FLAG_COMPRESSED, SPLIT_FLAG_LAST } from '../models';
import { SplitBmpReader } from './bmp/stream';
import { MAX_SPLIT_HEADER_BYTES, splitHeaderByteLength } from './bmp/index';
import { SERVER_ERRORS, throttleError, type ServerError, type ThrottleMode } from './errors';
import { downloadBmp } from './photos/index';

type ChunkSource = Pick<FileRequest, 'email' | 'token' | 'fileHash' | 'fileId' | 'name'>;

export function openChunk(
    input: ChunkSource,
    chunk: RemoteBmp,
    signal: AbortSignal | undefined,
    mode: ThrottleMode
): AsyncResult<SplitBmpReader, ServerError> {
    const compressed = chunk.compressed === true;
    const storedSize = compressed ? chunk.storedSize : chunk.size;
    if (storedSize === undefined)
        return Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.INVALID_CHUNK_METADATA));

    const expected: SplitHeader = {
        fileHash: input.fileHash,
        fileId: input.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: (chunk.isLast ? SPLIT_FLAG_LAST : 0) | (compressed ? SPLIT_FLAG_COMPRESSED : 0),
        payloadSize: storedSize,
        originalSize: compressed ? chunk.size : undefined,
        fileName: chunk.chunkIndex === 0 ? (chunk.sourceName ?? input.name) : undefined,
        folder: chunk.sourceFolder !== undefined ? chunk.sourceFolder || undefined : chunk.folder
    };

    return splitHeaderByteLength(expected)
        .andThen((length) =>
            length <= MAX_SPLIT_HEADER_BYTES
                ? Ok(undefined)
                : Err(SERVER_ERRORS.INVALID_CHUNK_METADATA)
        )
        .andThenAsync(() =>
            downloadBmp(
                input.email,
                input.token,
                chunk.mediaKey,
                chunk.sha1,
                undefined,
                signal
            ).mapErr((error) =>
                error.code === 'THROTTLED' ? throttleError(error.retryAfterSeconds, mode) : error
            )
        )
        .andThenAsync((response) => SplitBmpReader.open(response, expected, chunk.sha1));
}
