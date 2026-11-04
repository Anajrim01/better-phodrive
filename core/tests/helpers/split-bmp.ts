import { Err, Ok, type Result } from 'results-ts';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';
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
): Result<{ header: SplitHeader; payload: Uint8Array }, ServerError> {
    return decodeSplitHeader(bmp, bmp.length).andThen(({ header, payloadOffset }) => {
        const payloadEnd = payloadOffset + header.payloadSize;
        if (bmp.subarray(payloadEnd).some(Boolean))
            return Err(SERVER_ERRORS.INVALID_DOWNLOADED_BMP);

        return Ok({ header, payload: bmp.subarray(payloadOffset, payloadEnd) });
    });
}
