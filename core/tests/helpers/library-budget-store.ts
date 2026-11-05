import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { Ok } from 'results-ts';

export type MemoryStore = ChunkMetadataStore & {
    rows: Map<string, ChunkMetadataRecord>;
    loads: number;
    saves: number;
    hits: number;
    misses: number;
};

/** Mirrors the production predicate so budget tests count the same hits and misses. */
export function matchingRow(
    store: MemoryStore,
    candidate: { mediaKey: string; sha1: string; size: number }
): ChunkMetadataRecord | undefined {
    const row = store.rows.get(candidate.mediaKey);
    if (!row || row.sha1 !== candidate.sha1 || row.storedBmpSize !== candidate.size)
        return undefined;

    return row;
}

export function memoryStore(initial: readonly ChunkMetadataRecord[] = []): MemoryStore {
    const rows = new Map(initial.map((row) => [row.mediaKey, row]));
    const store: MemoryStore = {
        rows,
        loads: 0,
        saves: 0,
        hits: 0,
        misses: 0,
        load(candidates) {
            store.loads++;

            return Ok(undefined).andThenAsync(async () => {
                const found = new Map<string, ChunkMetadataRecord>();
                for (const candidate of candidates) {
                    const row = rows.get(candidate.mediaKey);
                    if (matchingRow(store, candidate)) store.hits++;
                    else store.misses++;
                    if (row) found.set(candidate.mediaKey, row);
                }

                return Ok(found);
            });
        },
        save(records) {
            store.saves++;

            return Ok(undefined).andThenAsync(async () => {
                for (const row of records) rows.set(row.mediaKey, row);

                return Ok(undefined);
            });
        },
        remove(mediaKeys) {
            return Ok(undefined).andThenAsync(async () => {
                for (const mediaKey of mediaKeys) rows.delete(mediaKey);

                return Ok(undefined);
            });
        }
    };

    return store;
}
