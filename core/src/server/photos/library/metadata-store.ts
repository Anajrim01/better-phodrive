import type { AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import type { UploadedChunk } from '../../../files';
import type { ServerError } from '../../errors';
import { splitBmpByteLength } from '../../bmp';
import type { LibraryCandidate } from './metadata';

/** Bytes-derived fields that can be reused without probing the stored BMP again. */
export type ChunkMetadataRecord = {
    mediaKey: string;
    sha1: string;
    storedBmpSize: number;
    fileHash: string;
    fileId: string;
    chunkIndex: number;
    isLast: boolean;
    originalName?: string;
    folder?: string;
    size: number;
};

export type ChunkMetadataStore = {
    /** Load rows for one library page in one batched operation. */
    load: (
        candidates: readonly LibraryCandidate[]
    ) => AsyncResult<Map<string, ChunkMetadataRecord>, ServerError>;
    /** Persist confirmed rows. Callers must not write before Google confirms the media. */
    save: (records: readonly ChunkMetadataRecord[]) => Promise<void>;
};

export function chunkMetadataRecord(item: RemoteBmp, storedBmpSize: number): ChunkMetadataRecord {
    return {
        mediaKey: item.mediaKey,
        sha1: item.sha1,
        storedBmpSize,
        fileHash: item.fileHash,
        fileId: item.fileId,
        chunkIndex: item.chunkIndex,
        isLast: item.isLast,
        ...(item.originalName ? { originalName: item.originalName } : {}),
        ...(item.chunkIndex === 0 && item.folder ? { folder: item.folder } : {}),
        size: item.size
    };
}

/** Recover the stored BMP size from an uploaded chunk's resolved header. */
export function uploadedChunkMetadata(chunk: UploadedChunk): ChunkMetadataRecord | null {
    const header = {
        fileHash: chunk.fileHash,
        fileId: chunk.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: chunk.isLast ? 1 : 0,
        payloadSize: chunk.size,
        ...(chunk.chunkIndex === 0 && chunk.originalName ? { fileName: chunk.originalName } : {}),
        ...(chunk.chunkIndex === 0 && chunk.folder ? { folder: chunk.folder } : {})
    } as const;
    const size = splitBmpByteLength(header);

    return size.match({
        Ok: (storedBmpSize) => chunkMetadataRecord(chunk, storedBmpSize),
        Err: () => null
    });
}

/** Reconstruct the upstream RemoteBmp shape from a validated row and current listing. */
export function metadataItem(record: ChunkMetadataRecord, candidate: LibraryCandidate): RemoteBmp {
    return {
        fileHash: record.fileHash,
        fileId: record.fileId,
        chunkIndex: record.chunkIndex,
        isLast: record.isLast,
        ...(record.originalName ? { originalName: record.originalName } : {}),
        ...(record.chunkIndex === 0 && record.folder ? { folder: record.folder } : {}),
        size: record.size,
        at: candidate.at,
        mediaKey: candidate.mediaKey,
        sha1: candidate.sha1
    };
}

export function metadataMatches(record: ChunkMetadataRecord, candidate: LibraryCandidate): boolean {
    return record.sha1 === candidate.sha1 && record.storedBmpSize === candidate.size;
}
