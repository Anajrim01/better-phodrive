import { expect, test } from 'vitest';
import { Err, Ok } from 'results-ts';
import { transferFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import {
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    UploadStatus
} from '@madkarmaa/phodrive-core/models';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';

test('a throttled chunk waits and retries without committing twice', async () => {
    const file = new File(['retry me'], 'retry.bin');
    const attempts: string[] = [];
    const committed: UploadedChunk[] = [];
    let pausedFor: number | null = null;

    const transport: ChunkTransport = (metadata, _payload, onEvent) =>
        Ok(undefined).andThenAsync(async () => {
            const key = `${metadata.file.name}:${metadata.chunkIndex}`;
            attempts.push(key);

            if (attempts.length === 1) {
                const failure = Err({
                    code: 'THROTTLED',
                    message: 'Google is throttling requests. Retrying in about 1 s.',
                    retryAfterSeconds: 1
                } as const);

                return failure.andThenAsync(async () => Ok(undefined));
            }

            const identity = (
                await uploadIdentity(metadata.file.name, metadata.file.fileHash)
            ).unwrap();
            const plan = planChunks(
                {
                    name: metadata.file.name,
                    folder: metadata.file.folder,
                    size: metadata.file.size,
                    fileHash: metadata.file.fileHash
                },
                identity
            ).unwrap();
            const size = plan.sizes[metadata.chunkIndex];
            const header = plan.headers[metadata.chunkIndex];

            onEvent({
                type: UploadEventType.Progress,
                id: 0,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed: size,
                    reused: 0,
                    total: size
                }
            });
            onEvent({
                type: UploadEventType.Chunk,
                id: 0,
                chunk: {
                    fileHash: header.fileHash,
                    fileId: header.fileId,
                    chunkIndex: header.chunkIndex,
                    isLast: header.flags === 1,
                    originalName: header.fileName,
                    folder: header.folder,
                    size: header.payloadSize,
                    at: 1,
                    mediaKey: 'media-key',
                    sha1: metadata.sha1
                }
            });
            onEvent({
                type: UploadEventType.FileComplete,
                id: 0,
                result: {
                    status: UploadStatus.Uploaded,
                    mediaKey: 'media-key',
                    sha1: metadata.sha1
                }
            });

            return Ok(undefined);
        });

    const finished = await transferFiles(
        [file],
        'retry@example.com',
        'aas_et/retry',
        1,
        (job) => {
            if (job.retryAfterSeconds !== null) pausedFor = job.retryAfterSeconds;
        },
        (chunk) => committed.push(chunk),
        transport
    );

    expect(finished.isOk()).toBe(true);
    expect(attempts).toEqual(['retry.bin:0', 'retry.bin:0']);
    expect(committed).toHaveLength(1);
    expect(pausedFor).toBe(1);
});

test('a chunk that stays throttled fails the file after the retry limit', async () => {
    const file = new File(['retry me'], 'retry.bin');
    let attempts = 0;

    const transport: ChunkTransport = () => {
        attempts++;

        return Err({
            code: 'THROTTLED',
            message: 'Google is throttling requests. Retrying in about 1 s.',
            retryAfterSeconds: 1
        } as const).andThenAsync(async () => Ok(undefined));
    };

    let failure = '';
    await transferFiles(
        [file],
        'retry@example.com',
        'aas_et/retry',
        1,
        (job) => {
            if (job.status === UploadJobStatus.Error) failure = job.message;
        },
        () => {},
        transport
    );

    expect(attempts).toBe(4);
    expect(failure).toContain('throttling');
});
