import { createBrotliDecompress } from 'node:zlib';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    FileNameSchema,
    PreviewMode,
    PreviewUnavailableReason,
    type FilePreviewRequest,
    type RemoteBmp
} from '../models';
import {
    MAX_IMAGE_PREVIEW_BYTES,
    PREVIEW_TEXT_BYTES,
    PREVIEW_TEXT_LINES,
    previewModeFor
} from '../files';
import { SplitBmpReader } from './bmp/stream';
import { openChunk } from './chunk-open';
import { decompressPayload } from './compress';
import { SERVER_ERRORS, type ServerError, type ThrottleMode } from './errors';

export type PreviewResult =
    | { kind: 'image'; bytes: Uint8Array; contentType: string }
    | { kind: 'text'; text: string; truncated: boolean }
    | { kind: 'unavailable'; reason: PreviewUnavailableReason };

type TextPrefix = { bytes: Uint8Array; truncated: boolean };

const COMPRESSED_PREFIX_INPUT_BYTES = 8 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function unavailable(reason: PreviewUnavailableReason): Result<PreviewResult, ServerError> {
    return Ok({ kind: 'unavailable', reason });
}

function validateChunks(input: FilePreviewRequest): Result<RemoteBmp[], ServerError> {
    const chunks = input.chunks.toSorted((first, second) => first.chunkIndex - second.chunkIndex);
    if (
        !FileNameSchema.safeParse(input.name).success ||
        chunks.some(
            (chunk) => chunk.fileHash !== input.fileHash || chunk.fileId !== input.fileId
        ) ||
        chunks.some(
            (chunk, index) =>
                chunk.chunkIndex !== index ||
                chunk.isLast !== (index === chunks.length - 1) ||
                (index === 0 && chunk.originalName !== input.name)
        )
    )
        return Err(SERVER_ERRORS.INVALID_FILE_METADATA);

    return Ok(chunks);
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }

    return bytes;
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
    if (bytes.length < offset + text.length) return false;

    for (let index = 0; index < text.length; index++) {
        if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }

    return true;
}

function detectImageType(bytes: Uint8Array): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';

    if (
        bytes.length >= PNG_SIGNATURE.length &&
        PNG_SIGNATURE.every((value, index) => bytes[index] === value)
    )
        return 'image/png';

    if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
    if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';

    return null;
}

function imageIsComplete(contentType: string, bytes: Uint8Array): boolean {
    if (contentType === 'image/png')
        return (
            bytes.length >= PNG_IEND.length &&
            PNG_IEND.every(
                (value, index) => bytes[bytes.length - PNG_IEND.length + index] === value
            )
        );

    if (contentType === 'image/gif') return bytes[bytes.length - 1] === 0x3b;

    if (contentType === 'image/jpeg')
        return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;

    if (contentType === 'image/webp') {
        const size =
            (bytes[4] ?? 0) |
            ((bytes[5] ?? 0) << 8) |
            ((bytes[6] ?? 0) << 16) |
            ((bytes[7] ?? 0) << 24);

        return size + 8 === bytes.length;
    }

    return false;
}

function looksBinary(bytes: Uint8Array): boolean {
    if (bytes.length === 0) return false;

    let controls = 0;
    for (const byte of bytes) {
        if (byte === 0) return true;
        if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) controls++;
    }

    return controls > 0 && controls / bytes.length > 0.02;
}

function decodeText(bytes: Uint8Array): Result<string, void> {
    if (bytes.length === 0) return Ok('');
    if (looksBinary(bytes)) return Err(undefined);

    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let trim = 0; trim <= 3 && trim < bytes.length; trim++) {
        try {
            return Ok(decoder.decode(bytes.subarray(0, bytes.length - trim)));
        } catch {
            continue;
        }
    }

    return Err(undefined);
}

function boundLines(text: string): { text: string; truncated: boolean } {
    const lines = text.split('\n');
    if (lines.length <= PREVIEW_TEXT_LINES) return { text, truncated: false };

    return { text: lines.slice(0, PREVIEW_TEXT_LINES).join('\n'), truncated: true };
}

async function readStoredPayload(reader: SplitBmpReader): Promise<Result<Uint8Array, ServerError>> {
    const parts: Uint8Array[] = [];
    let total = 0;

    while (true) {
        const next = await reader.readPayload();
        if (next.isErr()) return Err(next.unwrapErr());

        const part = next.unwrap();
        if (part === null) break;

        parts.push(part);
        total += part.length;
    }

    return Ok(concat(parts, total));
}

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

async function readTextPrefix(
    reader: SplitBmpReader,
    chunk: RemoteBmp
): Promise<Result<TextPrefix, ServerError>> {
    if (chunk.compressed === true) return readCompressedTextPrefix(reader, chunk.size);

    return readRawTextPrefix(reader);
}

async function readImage(
    reader: SplitBmpReader,
    chunk: RemoteBmp
): Promise<Result<PreviewResult, ServerError>> {
    const stored = await readStoredPayload(reader);
    if (stored.isErr()) return Err(stored.unwrapErr());

    const bytes: Result<Uint8Array, ServerError> =
        chunk.compressed === true
            ? await decompressPayload(stored.unwrap(), chunk.size)
            : Ok(stored.unwrap());
    if (bytes.isErr()) return Err(bytes.unwrapErr());

    const image = bytes.unwrap();
    const contentType = detectImageType(image);
    if (contentType === null)
        return Ok({ kind: 'unavailable', reason: PreviewUnavailableReason.UnsupportedImage });
    if (!imageIsComplete(contentType, image))
        return Ok({ kind: 'unavailable', reason: PreviewUnavailableReason.IncompleteImage });

    return Ok({ kind: 'image', bytes: image, contentType });
}

async function readText(
    reader: SplitBmpReader,
    chunk: RemoteBmp,
    moreChunks: boolean
): Promise<Result<PreviewResult, ServerError>> {
    const prefix = await readTextPrefix(reader, chunk);
    if (prefix.isErr()) return Err(prefix.unwrapErr());

    const { bytes, truncated } = prefix.unwrap();
    const text = decodeText(bytes);
    if (text.isErr()) return Ok({ kind: 'unavailable', reason: PreviewUnavailableReason.Binary });

    const bounded = boundLines(text.unwrap());

    return Ok({
        kind: 'text',
        text: bounded.text,
        truncated: truncated || bounded.truncated || moreChunks
    });
}

/** Read chunk zero only; multi-chunk images fall back without spending a Google request. */
export function previewFile(
    input: FilePreviewRequest,
    signal?: AbortSignal,
    throttle: ThrottleMode = 'auto'
): AsyncResult<PreviewResult, ServerError> {
    const mode = previewModeFor(input.name);
    if (mode === null || mode !== input.mode)
        return Ok(undefined).andThenAsync(async () =>
            unavailable(PreviewUnavailableReason.Unsupported)
        );

    return validateChunks(input).andThenAsync(async (chunks) => {
        const first = chunks[0];
        if (mode === PreviewMode.Image) {
            if (chunks.length > 1) return unavailable(PreviewUnavailableReason.MultiChunk);
            if (first.size > MAX_IMAGE_PREVIEW_BYTES)
                return unavailable(PreviewUnavailableReason.TooLarge);
        }

        const opened = await openChunk(input, first, signal, throttle);
        if (opened.isErr()) return Err(opened.unwrapErr());

        const reader = opened.unwrap();
        const read =
            mode === PreviewMode.Image
                ? await readImage(reader, first)
                : await readText(reader, first, chunks.length > 1);
        const closed = await reader.close();

        if (read.isErr()) return read;
        if (closed.isErr()) return Err(closed.unwrapErr());

        return read;
    });
}
