import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    UploadEventType,
    UploadPhase,
    type SplitHeader,
    type UploadEvent,
    type UploadResponse
} from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { MAX_CHUNK_PAYLOAD_BYTES } from '../../bmp/format';
import { INVALID_UPLOAD_PROGRESS, type ChunkTransport } from './request';
import { hashUploadChunk } from './hash';

function invalidResponse(): Result<never, ApplicationError> {
    return Err(INVALID_UPLOAD_PROGRESS);
}

export function uploadChunk(
    file: File,
    header: SplitHeader,
    { email, token }: { email: string; token: string },
    transport: ChunkTransport,
    onProgress: (sent: number, reused: number) => void,
    onChunk: (
        chunk: UploadEvent & { type: UploadEventType.Chunk }
    ) => Result<void, ApplicationError>
): AsyncResult<UploadResponse, ApplicationError> {
    const start = header.chunkIndex * MAX_CHUNK_PAYLOAD_BYTES;
    const payload = file.slice(start, start + header.payloadSize);

    return hashUploadChunk(payload, header).andThenAsync(async ({ sha1, size }) => {
        const metadata = {
            email,
            token,
            file: {
                name: file.name,
                folder: header.folder,
                size: file.size,
                fileHash: header.fileHash
            },
            chunkIndex: header.chunkIndex,
            sha1
        };

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
                onProgress(sent, reused);

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
                    chunk.sha1 !== sha1
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

        return uploaded.andThen(() => (result ? Ok(result) : invalidResponse()));
    });
}
