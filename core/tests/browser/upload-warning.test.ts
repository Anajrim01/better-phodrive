import pLimit from 'p-limit';
import { Ok } from 'results-ts';
import { expect, test } from 'vitest';
import { uploadPlannedFile } from '@madkarmaa/phodrive-core/browser/upload/planned';
import type { ChunkTransport } from '@madkarmaa/phodrive-core/browser/upload/request';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import {
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type SplitHeader,
    type UploadEvent
} from '@madkarmaa/phodrive-core/models';

const headers: SplitHeader[] = [
    {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        flags: 0,
        payloadSize: 4,
        fileName: 'multi.bin'
    },
    {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 1,
        flags: 1,
        payloadSize: 4
    }
];

test('a metadata warning from an earlier chunk survives a later successful chunk', async () => {
    const file = new File(['abcd'], 'multi.bin');
    const transport: ChunkTransport = ({ metadata, header }, onEvent) => {
        const total = encodeSplitPrefix(header).unwrap().totalSize;
        const warnings =
            header.chunkIndex === 0 ? [{ code: 'METADATA_SAVE_FAILED' as const }] : undefined;
        const result = {
            status: UploadStatus.Uploaded,
            mediaKey: `media-${header.chunkIndex}`,
            sha1: metadata.sha1,
            ...(warnings ? { warnings } : {})
        };

        onEvent({
            type: UploadEventType.Progress,
            id: 0,
            progress: {
                phase: UploadPhase.Uploading,
                completed: total,
                reused: 0,
                total
            }
        }).unwrap();
        onEvent({
            type: UploadEventType.Chunk,
            id: 0,
            chunk: {
                fileHash: header.fileHash,
                fileId: header.fileId,
                chunkIndex: header.chunkIndex,
                isLast: Boolean(header.flags),
                originalName: header.fileName,
                size: header.payloadSize,
                at: 1,
                mediaKey: result.mediaKey,
                sha1: result.sha1
            }
        }).unwrap();
        onEvent({ type: UploadEventType.FileComplete, id: 0, result }).unwrap();

        return Ok(undefined).andThenAsync(async () => Ok(undefined));
    };
    const emitted: UploadEvent[] = [];
    const uploaded = await uploadPlannedFile(
        { file, id: 0 },
        { headers, sizes: headers.map((header) => header.payloadSize) },
        'test@example.com',
        transport,
        pLimit(2),
        (event) => {
            emitted.push(event);

            return Ok(undefined);
        }
    );

    expect(uploaded.isOk()).toBe(true);
    expect(emitted.find((event) => event.type === UploadEventType.FileComplete)).toMatchObject({
        result: {
            status: UploadStatus.Uploaded,
            warnings: [{ code: 'METADATA_SAVE_FAILED' }]
        }
    });
});
