import { constants, brotliCompress, brotliCompressSync, brotliDecompress } from 'node:zlib';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from './errors';

/** Do not spend Google quota on a payload the codec barely shrinks. */
export const COMPRESSION_MIN_SAVING = 0.05;
/** Below this size the saved bytes are negligible and the latency is not. */
export const COMPRESSION_MIN_BYTES = 4 * 1024;
/** One slice from the start decides whether to stream raw or buffer to compress. */
export const COMPRESSION_PROBE_BYTES = 85 * 1024;
/** Server and CLI both read this; set it before starting the process. */
export const COMPRESSION_ENV = 'PHODRIVE_COMPRESSION';
const COMPRESSION_QUALITY = 1;

/** Compression defaults on. `off`, `0`, `false`, and `no` keep the streaming raw path. */
export function compressionEnabled(): boolean {
    const value = process.env[COMPRESSION_ENV]?.trim().toLowerCase();

    return value !== 'off' && value !== '0' && value !== 'false' && value !== 'no';
}

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

function decompressAsync(input: Uint8Array, originalSize: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        brotliDecompress(input, { maxOutputLength: Math.max(1, originalSize) }, (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

/** Exact 5% edge: 100 bytes to 95 passes, 96 does not. */
export function compressionSavesEnough(originalSize: number, storedSize: number): boolean {
    return storedSize <= originalSize * (1 - COMPRESSION_MIN_SAVING);
}

/** Start, middle and end, so a compressible tail can outweigh a raw prefix. */
function probeSlices(payload: Uint8Array): Uint8Array[] {
    if (payload.length <= COMPRESSION_PROBE_BYTES * 3) return [payload];
    const size = COMPRESSION_PROBE_BYTES;
    const middle = Math.floor((payload.length - size) / 2);

    return [
        payload.subarray(0, size),
        payload.subarray(middle, middle + size),
        payload.subarray(payload.length - size)
    ];
}

/** True when a probe sample clears the saving threshold. */
export function probeCompressible(bytes: Uint8Array): boolean {
    if (bytes.length < COMPRESSION_MIN_BYTES) return false;

    try {
        const probe = brotliCompressSync(bytes, options(bytes.length));

        return compressionSavesEnough(bytes.length, probe.length);
    } catch {
        return false;
    }
}

/**
 * Compress a chunk before BMP encoding, or keep it raw when the codec does not
 * pay. Three slices decide before the full payload is compressed.
 */
export function compressPayload(payload: Uint8Array): AsyncResult<EncodedPayload, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const originalSize = payload.length;
        if (!compressionEnabled() || originalSize < COMPRESSION_MIN_BYTES)
            return Ok(rawPayload(payload));
        if (!probeSlices(payload).some(probeCompressible)) return Ok(rawPayload(payload));

        let compressed: Buffer;

        try {
            compressed = await compressAsync(payload);
        } catch {
            return Err(SERVER_ERRORS.COMPRESSION_FAILED);
        }
        if (!compressionSavesEnough(originalSize, compressed.length))
            return Ok(rawPayload(payload));

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
            payload = await decompressAsync(stored, originalSize);
        } catch {
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
        }
        if (payload.length !== originalSize) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

        return Ok(payload);
    });
}
