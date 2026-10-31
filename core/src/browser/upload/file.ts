import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadEventType, UploadPhase, UploadStatus, type UploadEvent } from '../../models';
import type { ApplicationError } from '../../errors';
import { folderFromFile } from '../../files';
import { planChunks, type UploadPlan } from '../../upload';
import type { ChunkTransport } from './request';
import { uploadChunk } from './chunk';
import { hashFile, uploadIdentity } from './hash';

const PROGRESS_INTERVAL_MS = 100;

export type UploadSourceOptions = {
    folder?: string;
    folders?: ReadonlyMap<File, string>;
    compress?: boolean;
};

export function uploadSource(
    { file, id }: { file: File; id: number },
    account: { email: string; token: string },
    transport: ChunkTransport,
    chunkLimit: ReturnType<typeof pLimit>,
    handle: (event: UploadEvent) => Result<void, ApplicationError>,
    options: UploadSourceOptions = {}
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const folder = options.folders?.get(file) ?? folderFromFile(file, options.folder);
        let lastProgress = 0;
        const prepared = await hashFile(file, (completed) => {
            const now = performance.now();
            if (completed !== file.size && now - lastProgress < PROGRESS_INTERVAL_MS) return;

            lastProgress = now;
            handle({
                type: UploadEventType.Progress,
                id,
                progress: { phase: UploadPhase.Preparing, completed, total: file.size }
            });
        }).andThenAsync((fileHash) =>
            uploadIdentity(file.name, fileHash, folder).map((fileId) => ({
                fileHash,
                fileId
            }))
        );
        if (prepared.isErr()) {
            prepared.inspectErr((error) =>
                handle({ type: UploadEventType.FileError, id, error: error.message })
            );

            return Ok(undefined);
        }

        const planned = prepared.andThen(({ fileHash, fileId }) =>
            planChunks(
                {
                    name: file.name,
                    folder: folder || undefined,
                    size: file.size,
                    fileHash
                },
                fileId
            )
        );
        if (planned.isErr()) {
            planned.inspectErr((error) =>
                handle({ type: UploadEventType.FileError, id, error: error.message })
            );

            return Ok(undefined);
        }

        return await planned.andThenAsync((plan) =>
            uploadPlannedFile(
                { file, id },
                plan,
                account,
                transport,
                chunkLimit,
                handle,
                options.compress === true
            )
        );
    });
}

export function uploadPlannedFile(
    { file, id }: { file: File; id: number },
    { headers, sizes }: UploadPlan,
    account: { email: string; token: string },
    transport: ChunkTransport,
    chunkLimit: ReturnType<typeof pLimit>,
    handle: (event: UploadEvent) => Result<void, ApplicationError>,
    compress = false
): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        const sent = headers.map(() => 0);
        const reused = headers.map(() => 0);
        let failure: ApplicationError | null = null;
        let uploadedAny = false;
        handle({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, reused: 0, total }
        });

        const results = await chunkLimit.map(headers, async (header) => {
            if (failure) return Err(failure);

            const result = await uploadChunk(
                file,
                header,
                account,
                transport,
                (completed, existing, retryAfterSeconds) => {
                    sent[header.chunkIndex] = completed;
                    reused[header.chunkIndex] = existing;
                    handle({
                        type: UploadEventType.Progress,
                        id,
                        progress: {
                            phase: UploadPhase.Uploading,
                            completed: sent.reduce((sum, size) => sum + size, 0),
                            reused: reused.reduce((sum, size) => sum + size, 0),
                            total,
                            ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds })
                        }
                    });
                },
                (event) => handle({ ...event, id }),
                compress
            );

            result.match({
                Ok: (response) => {
                    uploadedAny ||= response.status === UploadStatus.Uploaded;
                },
                Err: (error) => {
                    failure ??= error;
                }
            });

            return result;
        });

        const failed = results.find((result) => result.isErr());
        if (failed) {
            failed.inspectErr((error) =>
                handle({ type: UploadEventType.FileError, id, error: error.message })
            );

            return Ok(undefined);
        }

        const last = results.at(-1);
        if (!last) {
            handle({
                type: UploadEventType.FileError,
                id,
                error: 'No chunks were uploaded.'
            });

            return Ok(undefined);
        }

        last.inspect((result) =>
            handle({
                type: UploadEventType.FileComplete,
                id,
                result: {
                    ...result,
                    status: uploadedAny ? UploadStatus.Uploaded : UploadStatus.AlreadyExists
                }
            })
        );

        return Ok(undefined);
    });
}
