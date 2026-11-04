import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '../../errors';
import type { UploadedChunk } from '../../files';
import { MAX_CHUNK_PAYLOAD_BYTES } from '../../bmp/format';
import {
    UploadEventType,
    UploadPhase,
    type SplitHeader,
    type UploadEvent,
    type UploadProgress,
    type UploadResponse
} from '../../models';
import { hashUploadChunk } from './hash';
import { INVALID_UPLOAD_PROGRESS, UPLOAD_CANCELLED, type ChunkTransport } from './request';

export type ChunkEvent = UploadEvent & { type: UploadEventType.Chunk };

const CHUNK_RETRY_LIMIT = 4;

/** What the server has confirmed so far about the one chunk it reports under ID 0. */
interface ChunkReport {
    header: SplitHeader;
    sha1: string;
    size: number;
    sent: number;
    reused: number;
    saved: UploadedChunk | null;
    result: UploadResponse | null;
}

function invalidResponse(): Result<never, ApplicationError> {
    return Err(INVALID_UPLOAD_PROGRESS);
}

/** Progress only counts this chunk's bytes, and never goes backwards. */
function acceptProgress(report: ChunkReport, progress: UploadProgress) {
    const valid =
        progress.phase === UploadPhase.Uploading &&
        progress.total === report.size &&
        progress.completed >= report.sent &&
        progress.reused >= report.reused;
    if (!valid) return invalidResponse();

    report.sent = progress.completed;
    report.reused = progress.reused;

    return Ok(undefined);
}

/** The server must store exactly the chunk that was sent, once. */
function acceptChunk(report: ChunkReport, { chunk }: ChunkEvent, email: string) {
    const { header } = report;
    const matches =
        chunk.fileHash === header.fileHash &&
        chunk.fileId === header.fileId &&
        chunk.chunkIndex === header.chunkIndex &&
        chunk.isLast === Boolean(header.flags) &&
        chunk.size === header.payloadSize &&
        chunk.originalName === header.fileName &&
        chunk.sha1 === report.sha1;
    if (report.saved || !matches) return invalidResponse();

    report.saved = { ...chunk, email };

    return Ok(undefined);
}

/** Completion follows the stored chunk and accounts for every byte. */
function acceptResult(report: ChunkReport, result: UploadResponse) {
    const { saved } = report;
    const valid =
        saved !== null &&
        report.sent + report.reused === report.size &&
        result.sha1 === saved.sha1 &&
        result.mediaKey === saved.mediaKey;
    if (!valid) return invalidResponse();

    report.result = result;

    return Ok(undefined);
}

function acceptEvent(
    report: ChunkReport,
    event: UploadEvent,
    email: string,
    onProgress: (sent: number, reused: number, retryAfterSeconds?: number) => void,
    onChunk: (chunk: ChunkEvent) => Result<void, ApplicationError>
): Result<void, ApplicationError> {
    if (event.type === UploadEventType.Error)
        return event.retryAfterSeconds === undefined
            ? Err({ code: 'UPLOAD_FAILED', message: event.error } as const)
            : Err({
                  code: 'THROTTLED',
                  message: event.error,
                  retryAfterSeconds: event.retryAfterSeconds
              } as const);
    if (event.type === UploadEventType.Complete)
        return report.saved && report.result ? Ok(undefined) : invalidResponse();
    if (event.id !== 0 || report.result) return invalidResponse();

    switch (event.type) {
        case UploadEventType.Progress: {
            const retryAfterSeconds =
                'retryAfterSeconds' in event.progress
                    ? event.progress.retryAfterSeconds
                    : undefined;

            return acceptProgress(report, event.progress).map(() =>
                onProgress(report.sent, report.reused, retryAfterSeconds)
            );
        }
        case UploadEventType.Chunk:
            return acceptChunk(report, event, email).andThen(() => onChunk(event));
        case UploadEventType.FileComplete:
            return acceptResult(report, event.result);
        default:
            return invalidResponse();
    }
}

/** Hash one planned chunk, send it, and check every event the server reports about it. */
export function uploadChunk(
    file: File,
    header: SplitHeader,
    email: string,
    transport: ChunkTransport,
    onProgress: (sent: number, reused: number, retryAfterSeconds?: number) => void,
    onChunk: (chunk: ChunkEvent) => Result<void, ApplicationError>,
    signal?: AbortSignal
): AsyncResult<UploadResponse, ApplicationError> {
    const start = header.chunkIndex * MAX_CHUNK_PAYLOAD_BYTES;
    const payload = file.slice(start, start + header.payloadSize);

    return hashUploadChunk(payload, header).andThenAsync(async ({ sha1, size }) => {
        const metadata = {
            file: { name: file.name, size: file.size, fileHash: header.fileHash },
            chunkIndex: header.chunkIndex,
            sha1
        };
        let emitted = 0;

        for (let attempt = 1; attempt <= CHUNK_RETRY_LIMIT; attempt++) {
            if (signal?.aborted) return Err(UPLOAD_CANCELLED);

            const report: ChunkReport = {
                header,
                sha1,
                size,
                sent: 0,
                reused: 0,
                saved: null,
                result: null
            };

            const uploaded = await transport({ metadata, payload, header }, (event) =>
                acceptEvent(
                    report,
                    event,
                    email,
                    (sent, reused, retryAfterSeconds) => {
                        if (retryAfterSeconds !== undefined) {
                            onProgress(sent, reused, retryAfterSeconds);

                            return;
                        }
                        if (sent + reused <= emitted) return;

                        emitted = sent + reused;
                        onProgress(sent, reused);
                    },
                    onChunk
                )
            );

            if (signal?.aborted) return Err(UPLOAD_CANCELLED);

            const failure = uploaded.match<ApplicationError | null>({
                Ok: () => null,
                Err: (error) => error
            });
            if (!failure) return report.result ? Ok(report.result) : invalidResponse();
            if (failure.code !== 'THROTTLED') return Err(failure);
            // The server recorded the shared account cooldown; the next request waits there.
            if (attempt === CHUNK_RETRY_LIMIT) return Err(failure);
        }

        return invalidResponse();
    });
}
