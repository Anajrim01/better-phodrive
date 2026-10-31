import { createHash } from 'node:crypto';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    type SplitHeader
} from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { compressPayload } from '@madkarmaa/phodrive-core/server/compress';

export const FILE_HASH = createHash('sha256').update('compression-fixture').digest('hex');
export const FILE_ID = createHash('sha256').update('compression-file-id').digest('hex');
export const NAME = 'sample.bin';

export function header(
    originalSize: number,
    storedSize: number,
    compressed: boolean,
    fileHash = FILE_HASH,
    fileId = FILE_ID,
    chunkIndex = 0,
    last = true
): SplitHeader {
    return {
        fileHash,
        fileId,
        chunkIndex,
        flags: (last ? SPLIT_FLAG_LAST : 0) | (compressed ? SPLIT_FLAG_COMPRESSED : 0),
        payloadSize: storedSize,
        originalSize: compressed ? originalSize : undefined,
        fileName: chunkIndex === 0 ? NAME : undefined
    };
}

export async function encoded(payload: Uint8Array, fileHash = FILE_HASH, fileId = FILE_ID) {
    const result = await compressPayload(payload);
    if (result.isErr()) throw new Error(result.unwrapErr().message);

    const stored = result.unwrap();
    const split = header(
        stored.originalSize,
        stored.storedSize,
        stored.compressed,
        fileHash,
        fileId
    );
    const bmp = encodeSplitBmp(stored.data, split);

    return {
        stored,
        split,
        bmp: bmp.unwrap()
    };
}
