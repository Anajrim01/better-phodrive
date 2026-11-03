import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    UploadEventType,
    UploadPhase,
    Sha1HexSchema,
    type SplitHeader,
    type UploadEvent,
    type UploadResponse
} from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { MAX_CHUNK_PAYLOAD_BYTES } from '../../bmp/format';
import { INVALID_UPLOAD_PROGRESS, type ChunkTransport } from './request';
import { hashUploadChunk } from './hash';
import { createThrottleCoordinator, type ThrottleCoordinator } from './throttle';

const CHUNK_RETRY_LIMIT = 4;

function invalidResponse(): Result<never, ApplicationError> {
    return Err(INVALID_UPLOAD_PROGRESS);
}

export function uploadChunk(
    file: File,
    header: SplitHeader,
    { email, token }: { email: string; token: string },
    transport: ChunkTransport,
    onProgress: (sent: number, reused: number, retryAfterSeconds?: number) => void,
    onChunk: (
        chunk: UploadEvent & { type: UploadEventType.Chunk }
    ) => Result<void, ApplicationError>,
    compress = false,
    folder = '',
    throttle: ThrottleCoordinator = createThrottleCoordinator(),
    signal?: AbortSignal
): AsyncResult<UploadResponse, ApplicationError> {
    const start = header.chunkIndex * MAX_CHUNK_PAYLOAD_BYTES;
    const payload = file.slice(start, start + header.payloadSize);

    return hashUploadChunk(payload, header).andThenAsync(async ({ sha1, size }) => {
        const metadata = {
            email,
            token,
            file: {
                name: file.name,
                folder: folder || undefined,
                size: file.size,
                fileHash: header.fileHash
            },
            chunkIndex: header.chunkIndex,
            sha1,
            compress
        };
        let emitted = 0;

        for (let attempt = 1; attempt <= CHUNK_RETRY_LIMIT; attempt++) {
            if (signal?.aborted)
                return Err({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.' } as const);

            try {
                await throttle.wait(email, signal);
            } catch {
                return Err({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.' } as const);
            }
            if (signal?.aborted)
                return Err({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.' } as const);

            let sent = 0;
            let reused = 0;
            let saved: UploadedChunk | null = null;
            let result: UploadResponse | null = null;

            const uploaded = await transport(metadata, payload, (event) => {
                if (event.type === UploadEventType.Error)
                    return Err({ code: 'UPLOAD_FAILED', message: event.error } as const);
                if (event.type === UploadEventType.Complete)
                    return saved && result ? Ok(undefined) : invalidResponse();
                if (event.id !== 0 || result) return invalidResponse();
                if (event.type === UploadEventType.Progress) {
                    const progress = event.progress;
                    if (
                        progress.phase !== UploadPhase.Uploading ||
                        progress.total !== size ||
                        progress.completed < sent ||
                        progress.reused < reused
                    )
                        return invalidResponse();

                    sent = progress.completed;
                    reused = progress.reused;
                    if (sent + reused > emitted) {
                        emitted = sent + reused;
                        onProgress(sent, reused);
                    }

                    return Ok(undefined);
                }
                if (event.type === UploadEventType.Chunk) {
                    const chunk = event.chunk;
                    if (
                        saved ||
                        chunk.fileHash !== header.fileHash ||
                        chunk.fileId !== header.fileId ||
                        chunk.chunkIndex !== header.chunkIndex ||
                        chunk.isLast !== Boolean(header.flags) ||
                        chunk.size !== header.payloadSize ||
                        chunk.originalName !== header.fileName ||
                        chunk.folder !== header.folder ||
                        (chunk.compressed
                            ? !Sha1HexSchema.safeParse(chunk.sha1).success
                            : chunk.sha1 !== sha1)
                    )
                        return invalidResponse();

                    saved = { ...chunk, email };

                    return onChunk(event);
                }
                if (event.type === UploadEventType.FileComplete) {
                    if (
                        !saved ||
                        sent + reused !== size ||
                        event.result.sha1 !== saved.sha1 ||
                        event.result.mediaKey !== saved.mediaKey
                    )
                        return invalidResponse();

                    result = event.result;

                    return Ok(undefined);
                }

                return invalidResponse();
            });

            const failure = uploaded.match<ApplicationError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            if (signal?.aborted)
                return Err({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.' } as const);
            if (!failure) return result ? Ok(result) : invalidResponse();
            if (failure.code !== 'THROTTLED') return Err(failure);

            const wait = throttle.pause(email, failure.retryAfterSeconds);
            if (attempt === CHUNK_RETRY_LIMIT) return Err(failure);
            onProgress(sent, reused, wait);
        }

        return invalidResponse();
    });
}
