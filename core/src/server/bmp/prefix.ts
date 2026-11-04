import { Err, Ok, type Result } from 'results-ts';
import type { SplitHeader } from '../../models';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { decodeSplitHeader, MAX_PHOTOS_BMP_BYTES } from './index';

/** Where a downloaded BMP ends, where its payload ends, and its verified header. */
export interface BmpLayout {
    header: SplitHeader;
    totalSize: number;
    payloadEnd: number;
}

function sameHeader(header: SplitHeader, expected: SplitHeader): boolean {
    return (
        header.fileHash === expected.fileHash &&
        header.fileId === expected.fileId &&
        header.chunkIndex === expected.chunkIndex &&
        header.flags === expected.flags &&
        header.payloadSize === expected.payloadSize &&
        header.originalSize === expected.originalSize &&
        header.fileName === expected.fileName &&
        header.folder === expected.folder
    );
}

/**
 * Check a downloaded BMP's prefix holds exactly the expected split header. `received` counts the
 * bytes read so far, which must not already exceed the size the BMP declares.
 */
export function checkDownloadedPrefix(
    prefix: Uint8Array,
    expected: SplitHeader,
    received: number
): Result<BmpLayout, ServerError> {
    const totalSize = new DataView(prefix.buffer, prefix.byteOffset).getUint32(2, true);
    if (totalSize > MAX_PHOTOS_BMP_BYTES || received > totalSize)
        return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

    return decodeSplitHeader(prefix, totalSize).andThen(({ header, payloadOffset }) => {
        if (!sameHeader(header, expected) || payloadOffset !== prefix.length)
            return Err(SERVER_ERRORS.DOWNLOAD_CHUNK_MISMATCH);

        return Ok({ header, totalSize, payloadEnd: payloadOffset + header.payloadSize });
    });
}
