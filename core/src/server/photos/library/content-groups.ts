/**
 * Byte-identical stored copies share one probe. Equality uses the app's stored-object
 * identity, the listing SHA-1 and stored BMP size. The metadata index and download
 * integrity checks rely on the same SHA-1 contract.
 */
import type { ChunkMetadataRecord } from './metadata-store';
import type { LibraryCandidate } from './metadata';

export function contentKey(sha1: string, storedBmpSize: number): string {
    return `${sha1}:${storedBmpSize}`;
}

/** Index loaded rows by stored bytes so an identical cold media key can reuse one. */
export function contentIndex(
    rows: Iterable<ChunkMetadataRecord>
): Map<string, ChunkMetadataRecord> {
    const index = new Map<string, ChunkMetadataRecord>();

    for (const row of rows) {
        const key = contentKey(row.sha1, row.storedBmpSize);
        if (!index.has(key)) index.set(key, row);
    }

    return index;
}

/** Matching stored identity means equal header fields, so only listing fields differ. */
export function contentRecord(
    record: ChunkMetadataRecord,
    candidate: LibraryCandidate
): ChunkMetadataRecord {
    return {
        ...record,
        mediaKey: candidate.mediaKey,
        sha1: candidate.sha1,
        storedBmpSize: candidate.size
    };
}

export function groupByContent(candidates: readonly LibraryCandidate[]): LibraryCandidate[][] {
    const groups = new Map<string, LibraryCandidate[]>();

    for (const candidate of candidates) {
        const key = contentKey(candidate.sha1, candidate.size);
        const group = groups.get(key);
        if (group) group.push(candidate);
        else groups.set(key, [candidate]);
    }

    return [...groups.values()];
}
