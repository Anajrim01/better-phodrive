import { expect, test } from 'vitest';
import { Err, Ok } from 'results-ts';
import { uploadChunk } from '@madkarmaa/phodrive-core/browser/upload/chunk';
import {
    INVALID_UPLOAD_PROGRESS,
    type ChunkTransport
} from '@madkarmaa/phodrive-core/browser/upload/request';
import type { ChunkUploadRequest, SplitHeader } from '@madkarmaa/phodrive-core/models';

test('a later chunk keeps the file folder in its upload metadata', async () => {
    const file = new File([new Uint8Array(10)], 'setup.exe');
    const header: SplitHeader = {
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 1,
        flags: 1,
        payloadSize: 1
    };
    let captured: ChunkUploadRequest | undefined;
    const transport: ChunkTransport = (metadata) => {
        captured = metadata;

        return Err(INVALID_UPLOAD_PROGRESS).andThenAsync(async () => Ok(undefined));
    };

    const uploaded = await uploadChunk(
        file,
        header,
        { email: 'demo@example.com', token: 'token' },
        transport,
        () => {},
        () => Ok(undefined),
        true,
        'Downloads'
    );

    expect(uploaded.isErr()).toBe(true);
    expect(captured?.file.folder).toBe('Downloads');
});
