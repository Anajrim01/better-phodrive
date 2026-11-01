import { createBrotliDecompress } from 'node:zlib';
import { Err, Ok, type Result } from 'results-ts';
import type { RemoteBmp } from '../../models';
import { PREVIEW_TEXT_BYTES } from '../../preview';
import type { SplitBmpReader } from '../bmp/stream';
import { decompressPayload } from '../compress';
import { SERVER_ERRORS, type ServerError } from '../errors';
import { concat, readStoredPayload } from './payload';

export type TextPrefix = { bytes: Uint8Array; truncated: boolean };

const COMPRESSED_PREFIX_INPUT_BYTES = 8 * 1024;

async function readRawTextPrefix(reader: SplitBmpReader): Promise<Result<TextPrefix, ServerError>> {
    const parts: Uint8Array[] = [];
    let total = 0;

    while (total <= PREVIEW_TEXT_BYTES) {
        const next = await reader.readPayload();
        if (next.isErr()) return Err(next.unwrapErr());

        const part = next.unwrap();
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
}

async function readCompressedTextPrefix(
    reader: SplitBmpReader,
    originalSize: number
): Promise<Result<TextPrefix, ServerError>> {
    if (originalSize <= PREVIEW_TEXT_BYTES) {
        const stored = await readStoredPayload(reader);
        if (stored.isErr()) return Err(stored.unwrapErr());

        const bytes = await decompressPayload(stored.unwrap(), originalSize);

        return bytes.map((value) => ({ bytes: value, truncated: false }));
    }

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
        if (limited) return;

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
        while (!limited) {
            const next = await reader.readPayload();
            if (next.isErr()) return Err(next.unwrapErr());

            const part = next.unwrap();
            if (part === null) break;

            for (
                let offset = 0;
                offset < part.length && !limited;
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
        if (!limited) {
            const ended = new Promise<void>((resolve, reject) => {
                decoder.end((error: Error | null | undefined) =>
                    error ? reject(error) : resolve()
                );
            });
            ended.catch(() => undefined);
            await Promise.race([ended, stopped]);
        }
    } catch {
        if (!limited) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
    } finally {
        decoder.destroy();
    }

    if (failed && !limited) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

    const bytes = concat(parts, total);
    if (!limited && bytes.length !== originalSize) return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

    return Ok({
        bytes: bytes.subarray(0, PREVIEW_TEXT_BYTES),
        truncated: limited
    });
}

export function readTextPrefix(
    reader: SplitBmpReader,
    chunk: RemoteBmp
): Promise<Result<TextPrefix, ServerError>> {
    if (chunk.compressed === true) return readCompressedTextPrefix(reader, chunk.size);

    return readRawTextPrefix(reader);
}
