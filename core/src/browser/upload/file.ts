import pLimit from 'p-limit';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { UploadEventType, UploadPhase, UploadStatus, type UploadEvent } from '../../models';
import type { ApplicationError } from '../../errors';
import type { UploadPlan } from '../../upload';
import type { ChunkTransport } from './request';
import { uploadChunk } from './chunk';

export function uploadPlannedFile(
    { file, id }: { file: File; id: number },
    { headers, sizes }: UploadPlan,
    account: { email: string; token: string },
    transport: ChunkTransport,
    chunkLimit: ReturnType<typeof pLimit>,
    handle: (event: UploadEvent) => Result<void, ApplicationError>
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
                (event) => handle({ ...event, id })
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
