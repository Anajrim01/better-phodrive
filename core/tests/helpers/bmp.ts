import { brotliDecompressSync } from 'node:zlib';
import { Err, Ok, type Result } from 'results-ts';
import { decodeSplitHeader } from '@madkarmaa/phodrive-core/server/bmp';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { splitHeaderIsCompressed, type SplitHeader } from '@madkarmaa/phodrive-core/models';

/** Test-only counterpart to the production download reader. */
export function decodeSplitBmp(
    bmp: Uint8Array
): Result<{ header: SplitHeader; payload: Uint8Array }, ServerError> {
    return decodeSplitHeader(bmp, bmp.length).andThen(({ header, payloadOffset }) => {
        const payloadEnd = payloadOffset + header.payloadSize;
        if (bmp.subarray(payloadEnd).some(Boolean))
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

        const stored = bmp.subarray(payloadOffset, payloadEnd);
        if (!splitHeaderIsCompressed(header.flags)) return Ok({ header, payload: stored });

        try {
            const payload = brotliDecompressSync(stored, {
                maxOutputLength: header.originalSize
            });
            if (payload.length !== header.originalSize)
                return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

            return Ok({ header, payload });
        } catch {
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);
        }
    });
}
