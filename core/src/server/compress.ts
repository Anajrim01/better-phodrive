import { constants, brotliCompress, brotliCompressSync, brotliDecompress } from 'node:zlib';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from './errors';

/** Do not spend Google quota on a payload the codec barely shrinks. */
export const COMPRESSION_MIN_SAVING = 0.05;
/** Below this size the saved bytes are negligible and the latency is not. */
export const COMPRESSION_MIN_BYTES = 4 * 1024;
/** A representative prefix decides whether the whole chunk is worth compressing. */
export const COMPRESSION_PROBE_BYTES = 256 * 1024;
const COMPRESSION_QUALITY = 1;

export interface EncodedPayload {
    data: Uint8Array;
    compressed: boolean;
    originalSize: number;
    storedSize: number;
}

function options(size: number) {
    return {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: COMPRESSION_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: size
        }
    };
}

function compressAsync(input: Uint8Array): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        brotliCompress(input, options(input.length), (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

function decompressAsync(input: Uint8Array): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        brotliDecompress(input, (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

function worthSaving(originalSize: number, storedSize: number): boolean {
    return storedSize <= originalSize * (1 - COMPRESSION_MIN_SAVING);
}

/**
 * Compress a chunk before BMP encoding, or keep it raw when the codec does not
 * pay. A cheap probe avoids spending CPU on already-compressed media.
 */
export function compressPayload(payload: Uint8Array): AsyncResult<EncodedPayload, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const originalSize = payload.length;
        if (originalSize < COMPRESSION_MIN_BYTES) return Ok(rawPayload(payload));

        const probeSize = Math.min(originalSize, COMPRESSION_PROBE_BYTES);
        let probe: Buffer;

        try {
            probe = brotliCompressSync(payload.subarray(0, probeSize), options(probeSize));
        } catch {
            return Err(SERVER_ERRORS.COMPRESSION_FAILED);
        }
        if (!worthSaving(probeSize, probe.length)) return Ok(rawPayload(payload));
        if (probeSize === originalSize) return Ok(compressedPayload(probe, originalSize));

        let compressed: Buffer;

        try {
            compressed = await compressAsync(payload);
        } catch {
            return Err(SERVER_ERRORS.COMPRESSION_FAILED);
        }
        if (!worthSaving(originalSize, compressed.length)) return Ok(rawPayload(payload));

        return Ok(compressedPayload(compressed, originalSize));
    });
}

function rawPayload(payload: Uint8Array): EncodedPayload {
    return {
        data: payload,
        compressed: false,
        originalSize: payload.length,
        storedSize: payload.length
    };
}

function compressedPayload(data: Uint8Array, originalSize: number): EncodedPayload {
    return {
        data,
        compressed: true,
        originalSize,
        storedSize: data.length
    };
}

/** Decompress a stored chunk and require the header's original byte count. */
export function decompressPayload(
    stored: Uint8Array,
    originalSize: number
): AsyncResult<Uint8Array, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        let payload: Buffer;

        try {
            payload = await decompressAsync(stored);
        } catch {
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
        }
        if (payload.length !== originalSize) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

        return Ok(payload);
    });
}
