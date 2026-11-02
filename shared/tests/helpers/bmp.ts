import { brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const BMP_HEADER_BYTES = 54;
export const FLAG_LAST = 1;
export const FLAG_COMPRESSED = 2;

export interface ChunkOptions {
    payload: Uint8Array;
    fileHash: string;
    fileId: string;
    index: number;
    flags: number;
    originalSize?: number;
    name?: string;
    folder?: string;
    paddingByte?: number;
}

function encodeVarint(value: number): number[] {
    const bytes: number[] = [];
    let remaining = value;

    do {
        let byte = remaining % 128;
        remaining = Math.floor(remaining / 128);
        if (remaining > 0) byte |= 0x80;
        bytes.push(byte);
    } while (remaining > 0);

    return bytes;
}

export function hashBytes(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function utf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

export function encodeChunk(options: ChunkOptions): Uint8Array {
    const header: number[] = new Array(BMP_HEADER_BYTES).fill(0);
    header.push(...utf8('BMSPLIT'), options.folder && options.index === 0 ? 2 : 1);
    header.push(...Buffer.from(options.fileHash, 'hex'));
    header.push(...Buffer.from(options.fileId, 'hex'));
    header.push(...encodeVarint(options.index), options.flags);
    header.push(...encodeVarint(options.payload.length));

    if (options.flags & FLAG_COMPRESSED) header.push(...encodeVarint(options.originalSize ?? 0));

    if (options.index === 0) {
        const name = utf8(options.name ?? 'file.txt');
        header.push(...encodeVarint(name.length), ...name);

        if (options.folder) {
            const folder = utf8(options.folder);
            header.push(...encodeVarint(folder.length), ...folder);
        }
    }

    const width = Math.max(
        256,
        Math.ceil(
            (Math.floor(
                Math.sqrt(
                    Math.ceil((header.length - BMP_HEADER_BYTES + options.payload.length) / 3)
                )
            ) +
                1) /
                4
        ) * 4
    );
    const stride = width * 3;
    const height = Math.max(
        256,
        Math.ceil((header.length - BMP_HEADER_BYTES + options.payload.length) / stride)
    );
    const total = BMP_HEADER_BYTES + stride * height;
    const prefix = Uint8Array.from(header);
    const view = new DataView(prefix.buffer);

    prefix.set([66, 77]);
    view.setUint32(2, total, true);
    view.setUint32(10, BMP_HEADER_BYTES, true);
    view.setUint32(14, 40, true);
    view.setUint32(18, width, true);
    view.setUint32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(34, total - BMP_HEADER_BYTES, true);

    const bytes = new Uint8Array(total);
    bytes.set(prefix);
    bytes.set(options.payload, header.length);
    bytes.fill(options.paddingByte ?? 0, header.length + options.payload.length);

    return bytes;
}

export interface SplitFileOptions {
    name: string;
    data: Uint8Array;
    chunks: number;
    folder?: string;
    compressed?: boolean;
    fileHash?: string;
    fileId?: string;
    omitLastFlag?: boolean;
    paddingByte?: number;
}

export interface SplitFile {
    original: Uint8Array;
    fileHash: string;
    fileId: string;
    chunks: Uint8Array[];
    name: string;
    folder?: string;
}

export function makeSplitFile(options: SplitFileOptions): SplitFile {
    const fileId = options.fileId ?? hashBytes(`id:${options.name}`);
    const fileHash = options.fileHash ?? sha256Hex(options.data);
    const chunkSize = Math.max(1, Math.ceil(options.data.length / options.chunks));
    const chunks: Uint8Array[] = [];

    for (let index = 0; index < options.chunks; index++) {
        const start = index * chunkSize;
        const end = Math.min(options.data.length, start + chunkSize);
        const raw = options.data.subarray(start, end);
        const payload = options.compressed ? new Uint8Array(brotliCompressSync(raw)) : raw;
        const last = index === options.chunks - 1;

        chunks.push(
            encodeChunk({
                payload,
                fileHash,
                fileId,
                index,
                flags:
                    (last && !options.omitLastFlag ? FLAG_LAST : 0) |
                    (options.compressed ? FLAG_COMPRESSED : 0),
                originalSize: options.compressed ? raw.length : undefined,
                name: options.name,
                folder: options.folder,
                paddingByte: options.paddingByte
            })
        );
    }

    return {
        original: options.data,
        fileHash,
        fileId,
        chunks,
        name: options.name,
        folder: options.folder
    };
}

export function sha256Hex(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}
