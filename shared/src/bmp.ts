import { Err, Ok, type Result } from 'results-ts';
import { viewerFailure, type ViewerFailure } from './errors';
import { MAX_CHUNK_BYTES, MAX_PADDING_BYTES, MAX_SPLIT_HEADER_BYTES } from './limits';

export const BMP_HEADER_BYTES = 54;
export const SPLIT_MAGIC_BYTES = 8;
export const FILE_HASH_BYTES = 32;
export const SPLIT_FLAG_LAST = 1;
export const SPLIT_FLAG_COMPRESSED = 2;
export const SPLIT_FLAGS_MAX = SPLIT_FLAG_LAST | SPLIT_FLAG_COMPRESSED;

const MAGIC = new TextEncoder().encode('BMSPLIT');
const HEX = /^[0-9a-f]{64}$/;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export interface ChunkHeader {
    fileHash: string;
    fileId: string;
    chunkIndex: number;
    flags: number;
    payloadSize: number;
    originalSize?: number;
    fileName?: string;
    folder?: string;
    totalSize: number;
    payloadOffset: number;
    paddingSize: number;
    compressed: boolean;
    last: boolean;
}

function invalid(message: string): ViewerFailure {
    return viewerFailure('chunk_invalid', message);
}

function hashHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function varintLength(value: number): number {
    let length = 1;
    let remaining = value;
    while (remaining >= 128) {
        remaining = Math.floor(remaining / 128);
        length++;
    }

    return length;
}

function readVarint(
    bytes: Uint8Array,
    start: number
): Result<{ value: number; next: number }, ViewerFailure> {
    let value = 0;
    let shift = 0;
    let offset = start;

    while (offset < bytes.length && shift < 53) {
        const byte = bytes[offset++];
        value += (byte & 0x7f) * 2 ** shift;

        if ((byte & 0x80) === 0) {
            if (!Number.isSafeInteger(value) || offset - start !== varintLength(value))
                return Err(invalid('Chunk header is malformed.'));

            return Ok({ value, next: offset });
        }

        shift += 7;
    }

    return Err(invalid('Chunk header is malformed.'));
}

export function isSplitChunk(bytes: Uint8Array): boolean {
    if (bytes.length < BMP_HEADER_BYTES + SPLIT_MAGIC_BYTES) return false;

    const version = bytes[BMP_HEADER_BYTES + MAGIC.length];

    return (
        MAGIC.every((byte, index) => bytes[BMP_HEADER_BYTES + index] === byte) &&
        (version === 1 || version === 2)
    );
}

function readName(
    bytes: Uint8Array,
    start: number
): Result<{ value: string; next: number }, ViewerFailure> {
    return readVarint(bytes, start).andThen((length) => {
        const end = length.next + length.value;
        if (length.value === 0 || length.value > 1_024 || end > bytes.length)
            return Err(invalid('Chunk name is missing or malformed.'));

        try {
            return Ok({ value: UTF8.decode(bytes.subarray(length.next, end)), next: end });
        } catch {
            return Err(invalid('Chunk name is missing or malformed.'));
        }
    });
}

function readPayload(
    bytes: Uint8Array,
    start: number,
    compressed: boolean
): Result<{ payloadSize: number; originalSize?: number; next: number }, ViewerFailure> {
    return readVarint(bytes, start).andThen((size) => {
        if (!compressed) return Ok({ payloadSize: size.value, next: size.next });

        return readVarint(bytes, size.next).map(
            (original): { payloadSize: number; originalSize: number; next: number } => ({
                payloadSize: size.value,
                originalSize: original.value,
                next: original.next
            })
        );
    });
}

function readNames(
    bytes: Uint8Array,
    start: number,
    chunkIndex: number,
    withFolder: boolean
): Result<{ fileName?: string; folder?: string; next: number }, ViewerFailure> {
    if (chunkIndex !== 0) {
        if (withFolder) return Err(invalid('Only the first chunk can carry a folder.'));

        return Ok({ next: start });
    }

    return readName(bytes, start).andThen((name) => {
        if (!withFolder) return Ok({ fileName: name.value, next: name.next });

        return readName(bytes, name.next).map(
            (folder): { fileName: string; folder: string; next: number } => ({
                fileName: name.value,
                folder: folder.value,
                next: folder.next
            })
        );
    });
}

function validateBitmap(view: DataView, totalSize: number): boolean {
    const width = view.getInt32(18, true);
    const height = view.getInt32(22, true);
    if (width < 32 || height < 32 || width % 4 !== 0) return false;
    if (width > MAX_CHUNK_BYTES || height > MAX_CHUNK_BYTES) return false;

    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_CHUNK_BYTES) return false;

    const imageSize = pixels * 3 + BMP_HEADER_BYTES;
    if (!Number.isSafeInteger(imageSize)) return false;

    return (
        view.getUint32(10, true) === BMP_HEADER_BYTES &&
        view.getUint32(14, true) === 40 &&
        view.getUint16(26, true) === 1 &&
        view.getUint16(28, true) === 24 &&
        view.getUint32(30, true) === 0 &&
        view.getUint32(34, true) === totalSize - BMP_HEADER_BYTES &&
        imageSize === totalSize
    );
}

export function parseChunkPrefix(prefix: Uint8Array): Result<ChunkHeader, ViewerFailure> {
    if (prefix.length < BMP_HEADER_BYTES + SPLIT_MAGIC_BYTES + 2 * FILE_HASH_BYTES + 3)
        return Err(invalid('Chunk header is incomplete.'));

    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    const totalSize = view.getUint32(2, true);
    if (
        prefix[0] !== 66 ||
        prefix[1] !== 77 ||
        totalSize < BMP_HEADER_BYTES ||
        totalSize > MAX_CHUNK_BYTES ||
        !validateBitmap(view, totalSize)
    )
        return Err(invalid('Chunk is not a valid Phodrive container.'));

    if (!isSplitChunk(prefix)) return Err(invalid('Chunk is not a Phodrive split file.'));

    const version = prefix[BMP_HEADER_BYTES + MAGIC.length];
    const withFolder = version === 2;
    let offset = BMP_HEADER_BYTES + SPLIT_MAGIC_BYTES;

    const fileHash = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;
    const fileId = hashHex(prefix.subarray(offset, offset + FILE_HASH_BYTES));
    offset += FILE_HASH_BYTES;
    if (!HEX.test(fileHash) || !HEX.test(fileId))
        return Err(invalid('Chunk hashes are malformed.'));

    return readVarint(prefix, offset).andThen((index) => {
        if (index.next >= prefix.length) return Err(invalid('Chunk header is incomplete.'));

        const flags = prefix[index.next];
        if (flags > SPLIT_FLAGS_MAX) return Err(invalid('Chunk flags are not supported.'));
        const compressed = (flags & SPLIT_FLAG_COMPRESSED) !== 0;

        return readPayload(prefix, index.next + 1, compressed).andThen((payload) =>
            readNames(prefix, payload.next, index.value, withFolder).andThen((names) => {
                const payloadOffset = names.next;
                if (payloadOffset > prefix.length || payloadOffset > MAX_SPLIT_HEADER_BYTES)
                    return Err(invalid('Chunk header is too large.'));
                if (payload.payloadSize > totalSize - payloadOffset)
                    return Err(invalid('Chunk payload does not fit the container.'));

                const paddingSize = totalSize - payloadOffset - payload.payloadSize;
                if (paddingSize > MAX_PADDING_BYTES)
                    return Err(invalid('Chunk padding is too large.'));
                if (
                    compressed &&
                    (payload.originalSize === undefined ||
                        payload.originalSize < payload.payloadSize)
                )
                    return Err(invalid('Compressed chunk size is inconsistent.'));
                if (payload.originalSize !== undefined && payload.originalSize > MAX_CHUNK_BYTES)
                    return Err(invalid('Chunk is too large.'));

                return Ok({
                    fileHash,
                    fileId,
                    chunkIndex: index.value,
                    flags,
                    payloadSize: payload.payloadSize,
                    originalSize: payload.originalSize,
                    fileName: names.fileName,
                    folder: names.folder,
                    totalSize,
                    payloadOffset,
                    paddingSize,
                    compressed,
                    last: (flags & SPLIT_FLAG_LAST) !== 0
                });
            })
        );
    });
}
