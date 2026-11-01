import { createBrotliDecompress } from 'node:zlib';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../models';
import { PREVIEW_TEXT_BYTES } from '../../preview';
import type { SplitBmpReader } from '../bmp/stream';
import { decompressPayload } from '../compress';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { concat, readStoredPayload } from './payload';

export type TextPrefix = { bytes: Uint8Array; truncated: boolean };

const COMPRESSED_PREFIX_INPUT_BYTES = 8 * 1024;

function readRawTextPrefix(reader: SplitBmpReader): AsyncResult<TextPrefix, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const parts: Uint8Array[] = [];
        let total = 0;

        while (total <= PREVIEW_TEXT_BYTES) {
            const next = await reader.readPayload();
            let failure: ServerError | null = null;
            const part = next.match({
                Ok: (value) => value,
                Err: (error) => {
                    failure = error;

                    return null;
                }
            });
            if (failure !== null) return Err(failure);
            if (part === null) break;

            const remaining = PREVIEW_TEXT_BYTES + 1 - total;
            const kept = part.subarray(0, Math.max(0, remaining));
            parts.push(kept);
            total += kept.length;
        }

        const bytes = concat(parts, total);

        return Ok({
            bytes: bytes.subarray(0, PREVIEW_TEXT_BYTES),
            truncated: bytes.length > PREVIEW_TEXT_BYTES
        });
    });
}

function readCompressedTextPrefix(
    reader: SplitBmpReader,
    originalSize: number
): AsyncResult<TextPrefix, ServerError> {
    if (originalSize <= PREVIEW_TEXT_BYTES)
        return readStoredPayload(reader).andThenAsync((stored) =>
            decompressPayload(stored, originalSize).map((bytes) => ({
                bytes,
                truncated: false
            }))
        );

    return Ok(undefined).andThenAsync(async () => {
        const decoder = createBrotliDecompress();
        const parts: Uint8Array[] = [];
        let total = 0;
        let limited = false;
        let failed = false;
        let release: (() => void) | null = null;
        const stopped = new Promise<void>((resolve) => {
            release = resolve;
        });

        decoder.on('data', (chunk: Buffer) => {
            if (limited || failed) return;

            const remaining = PREVIEW_TEXT_BYTES + 1 - total;
            if (remaining > 0) {
                const kept = chunk.subarray(0, remaining);
                parts.push(kept);
                total += kept.length;
            }
            if (total > PREVIEW_TEXT_BYTES) {
                limited = true;
                release?.();
                decoder.destroy();
            }
        });
        decoder.on('error', () => {
            if (limited) return;

            failed = true;
            release?.();
        });

        try {
            while (!limited && !failed) {
                const next = await reader.readPayload();
                let failure: ServerError | null = null;
                const part = next.match({
                    Ok: (value) => value,
                    Err: (error) => {
                        failure = error;

                        return null;
                    }
                });
                if (failure !== null) return Err(failure);
                if (part === null) break;

                for (
                    let offset = 0;
                    offset < part.length && !limited && !failed;
                    offset += COMPRESSED_PREFIX_INPUT_BYTES
                ) {
                    const slice = part.subarray(offset, offset + COMPRESSED_PREFIX_INPUT_BYTES);
                    const written = new Promise<void>((resolve, reject) => {
                        decoder.write(slice, (error: Error | null | undefined) =>
                            error ? reject(error) : resolve()
                        );
                    });
                    written.catch(() => undefined);
                    await Promise.race([written, stopped]);
                }
            }
            if (!limited && !failed) {
                const ended = new Promise<void>((resolve, reject) => {
                    decoder.end((error: Error | null | undefined) =>
                        error ? reject(error) : resolve()
                    );
                });
                ended.catch(() => undefined);
                await Promise.race([ended, stopped]);
            }
        } catch {
            if (!limited) failed = true;
        } finally {
            decoder.destroy();
        }

        if (failed && !limited) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

        const bytes = concat(parts, total);
        if (!limited && bytes.length !== originalSize)
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

        return Ok({
            bytes: bytes.subarray(0, PREVIEW_TEXT_BYTES),
            truncated: limited
        });
    });
}

export function readTextPrefix(
    reader: SplitBmpReader,
    chunk: RemoteBmp
): AsyncResult<TextPrefix, ServerError> {
    if (chunk.compressed === true) return readCompressedTextPrefix(reader, chunk.size);

    return readRawTextPrefix(reader);
}
