/**
 * Byte-identical stored copies share one probe. Equality uses the app's stored-object
 * identity, the listing SHA-1 and stored BMP size. The metadata index and download
 * integrity checks rely on the same SHA-1 contract.
 */
import { metadataItem, metadataMatches, type ChunkMetadataRecord } from './metadata-store';
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

export function planLibraryScan(
    candidates: readonly LibraryCandidate[],
    stored: ReadonlyMap<string, ChunkMetadataRecord>,
    maxProbes: number
) {
    const content = contentIndex(stored.values());
    const items = new Map<string, ReturnType<typeof metadataItem>>();
    const records: ChunkMetadataRecord[] = [];
    const groups = new Map<string, LibraryCandidate[]>();
    let scanned = 0;

    for (const candidate of candidates) {
        const key = contentKey(candidate.sha1, candidate.size);
        const storedRecord = stored.get(candidate.mediaKey);
        const shared = content.get(key);

        if (storedRecord && metadataMatches(storedRecord, candidate)) {
            items.set(candidate.mediaKey, metadataItem(storedRecord, candidate));
        } else if (shared) {
            const copied = contentRecord(shared, candidate);
            items.set(candidate.mediaKey, metadataItem(copied, candidate));
            records.push(copied);
        } else if (!candidate.trashed) {
            const group = groups.get(key);
            if (group) group.push(candidate);
            else {
                if (groups.size === maxProbes) break;
                groups.set(key, [candidate]);
            }
        }

        scanned++;
    }

    return { items, records, groups: [...groups.values()], scanned };
}
