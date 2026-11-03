import { createHash } from 'node:crypto';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Item } from './delta-library';

export type LibraryChunkInput = {
    fileHash: string;
    fileId: string;
    fileName: string;
    chunkIndex: number;
    chunkCount: number;
    folder?: string;
    payload: Uint8Array;
    stored?: Uint8Array;
    compressed?: boolean;
    mediaKey: string;
    at?: number;
};

export function hash(algorithm: 'sha1' | 'sha256', data: Uint8Array | string): string {
    return createHash(algorithm).update(data).digest('hex');
}

export function concatenate(parts: readonly Uint8Array[]): Uint8Array {
    return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

export function libraryChunk(input: LibraryChunkInput): Item {
    const stored = input.stored ?? input.payload;
    const last = input.chunkIndex === input.chunkCount - 1;
    const bmp = Buffer.from(
        encodeSplitBmp(stored, {
            fileHash: input.fileHash,
            fileId: input.fileId,
            chunkIndex: input.chunkIndex,
            flags: (last ? 1 : 0) | (input.compressed ? 2 : 0),
            payloadSize: stored.length,
            ...(input.compressed ? { originalSize: input.payload.length } : {}),
            ...(input.chunkIndex === 0
                ? {
                      fileName: input.fileName,
                      ...(input.folder ? { folder: input.folder } : {})
                  }
                : {})
        }).unwrap()
    );

    return {
        mediaKey: input.mediaKey,
        sha1: hash('sha1', bmp),
        size: bmp.length,
        at: input.at ?? 1,
        fileName: `${input.fileName}.phodrive-${input.fileHash}-${input.chunkIndex}-of-${input.chunkCount}.bmp`,
        bmp
    };
}
