import { Err, Ok, type Result } from 'results-ts';
import { brotliDecompressSync } from 'node:zlib';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import { splitHeaderIsCompressed, type SplitHeader } from '@madkarmaa/phodrive-core/models';
import { decodeSplitHeader } from '@madkarmaa/phodrive-core/server/bmp';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';

export function encodeSplitBmp(
    payload: Uint8Array,
    input: SplitHeader
): Result<Uint8Array<ArrayBuffer>, ServerError> {
    if (input.payloadSize !== payload.length) return Err(SERVER_ERRORS.INVALID_CHUNK_METADATA);

    return encodeSplitPrefix(input).map(({ prefix, totalSize }) => {
        const bmp = new Uint8Array(totalSize);
        bmp.set(prefix);
        bmp.set(payload, prefix.length);

        return bmp;
    });
}

export function decodeSplitBmp(
    bmp: Uint8Array
): Result<{ header: SplitHeader; payload: Uint8Array; storedPayload: Uint8Array }, ServerError> {
    type Decoded = { header: SplitHeader; payload: Uint8Array; storedPayload: Uint8Array };
    const ok = (header: SplitHeader, payload: Uint8Array, storedPayload: Uint8Array) =>
        Ok({ header, payload, storedPayload });

    return decodeSplitHeader(bmp, bmp.length).andThen(
        ({ header, payloadOffset }): Result<Decoded, ServerError> => {
            const payloadEnd = payloadOffset + header.payloadSize;
            if (bmp.subarray(payloadEnd).some(Boolean))
                return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

            const storedPayload = bmp.subarray(payloadOffset, payloadEnd);
            if (!splitHeaderIsCompressed(header.flags))
                return ok(header, storedPayload, storedPayload);

            try {
                const payload = brotliDecompressSync(storedPayload, {
                    maxOutputLength: Math.max(1, header.originalSize!)
                });
                if (payload.length !== header.originalSize)
                    return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

                return ok(header, payload, storedPayload);
            } catch {
                return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
            }
        }
    );
}
