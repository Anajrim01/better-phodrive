import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    FileNameSchema,
    FileSizeSchema,
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type UploadEvent,
    type UploadFile
} from '../../models';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { planChunks, type UploadPlan } from '../../upload';
import { chunkFileName, fileIdentity } from '../chunks';
import { photosFetchWithProgress, type Fetcher } from '../fetcher';
import { uploadBmpStream } from '../photos/index';
import { encodeUploadBmp } from './bmp';
import type { ReceivedUpload } from './input';

const PROGRESS_INTERVAL_MS = 100;

export function planUpload(file: UploadFile): Result<UploadPlan, ServerError> {
    const valid =
        FileNameSchema.safeParse(file.name).success && FileSizeSchema.safeParse(file.size).success;
    if (!valid) return Err(SERVER_ERRORS.INVALID_FILE_NAME_OR_SIZE);

    return planChunks(file, fileIdentity(file.name, file.fileHash, undefined, file.folder ?? ''));
}

/** Encode and forward one incoming chunk without disk storage. */
export function uploadFiles(
    input: ReceivedUpload,
    emit: (event: UploadEvent) => void,
    fetcher?: Fetcher
): AsyncResult<void, ServerError> {
    return encodeUploadBmp(input).andThenAsync(async (source) => {
        // Browser job totals are raw plan sizes, so map stored bytes back onto that
        // scale instead of letting the bar lag and jump at the forced final report.
        const progressTotal = input.bmp.totalSize;
        const scale = source.length > 0 ? progressTotal / source.length : 1;
        const scaled = (sent: number) => Math.min(progressTotal, Math.round(sent * scale));
        let lastProgress = 0;
        const report = (completed: number, reused = 0, force = false) => {
            const now = performance.now();
            if (!force && now - lastProgress < PROGRESS_INTERVAL_MS) return;

            lastProgress = now;
            emit({
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed,
                    reused,
                    total: progressTotal
                }
            });
        };
        report(0, 0, true);

        const uploaded = await uploadBmpStream(
            input.email,
            input.token,
            chunkFileName(
                input.file.name,
                input.file.fileHash,
                input.header.chunkIndex,
                input.chunkCount
            ),
            source,
            fetcher ?? photosFetchWithProgress((sent) => report(scaled(sent))),
            input.signal
        );

        return uploaded.map((result) => {
            const reused = result.status === UploadStatus.AlreadyExists ? progressTotal : 0;
            report(progressTotal - reused, reused, true);
            emit({
                type: UploadEventType.Chunk,
                id: 0,
                chunk: {
                    fileHash: input.header.fileHash,
                    fileId: input.header.fileId,
                    chunkIndex: input.header.chunkIndex,
                    isLast: source.last,
                    originalName: input.header.fileName,
                    folder: input.header.folder,
                    size: source.originalSize,
                    storedSize: source.storedSize,
                    compressed: source.compressed,
                    at: Date.now(),
                    mediaKey: result.mediaKey,
                    sha1: result.sha1
                }
            });
            emit({ type: UploadEventType.FileComplete, id: 0, result });
        });
    });
}
