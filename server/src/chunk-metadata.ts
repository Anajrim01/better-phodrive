import { and, eq, inArray, sql } from 'drizzle-orm';
import { Err, Ok } from 'results-ts';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { Database } from './db/client';
import { chunkMetadata } from './db/schema';

type Scope = { userId: string; googleEmail: string };

function record(row: typeof chunkMetadata.$inferSelect): ChunkMetadataRecord {
    return {
        mediaKey: row.mediaKey,
        sha1: row.sha1,
        storedBmpSize: row.storedBmpSize,
        fileHash: row.fileHash,
        fileId: row.fileId,
        chunkIndex: row.chunkIndex,
        isLast: row.isLast,
        ...(row.originalName ? { originalName: row.originalName } : {}),
        size: row.size
    };
}

/** Scope every query to the signed-in user and the currently connected Google account. */
export function createChunkMetadataStore(
    db: Database,
    { userId, googleEmail }: Scope
): ChunkMetadataStore {
    const scope = and(eq(chunkMetadata.userId, userId), eq(chunkMetadata.googleEmail, googleEmail));

    return {
        load(candidates) {
            return Ok(undefined).andThenAsync(async () => {
                const mediaKeys = [...new Set(candidates.map((candidate) => candidate.mediaKey))];
                if (mediaKeys.length === 0) return Ok(new Map());

                try {
                    const rows = await db
                        .select()
                        .from(chunkMetadata)
                        .where(and(scope, inArray(chunkMetadata.mediaKey, mediaKeys)));

                    return Ok(new Map(rows.map((row) => [row.mediaKey, record(row)])));
                } catch {
                    return Err(SERVER_ERRORS.METADATA_UNAVAILABLE);
                }
            });
        },

        save(records) {
            return Ok(undefined).andThenAsync(async () => {
                if (records.length === 0) return Ok(undefined);

                try {
                    await db
                        .insert(chunkMetadata)
                        .values(
                            records.map((item) => ({
                                userId,
                                googleEmail,
                                mediaKey: item.mediaKey,
                                sha1: item.sha1,
                                storedBmpSize: item.storedBmpSize,
                                fileHash: item.fileHash,
                                fileId: item.fileId,
                                chunkIndex: item.chunkIndex,
                                isLast: item.isLast,
                                originalName: item.originalName ?? null,
                                size: item.size
                            }))
                        )
                        .onConflictDoUpdate({
                            target: [
                                chunkMetadata.userId,
                                chunkMetadata.googleEmail,
                                chunkMetadata.mediaKey
                            ],
                            set: {
                                sha1: sql`excluded.sha1`,
                                storedBmpSize: sql`excluded.stored_bmp_size`,
                                fileHash: sql`excluded.file_hash`,
                                fileId: sql`excluded.file_id`,
                                chunkIndex: sql`excluded.chunk_index`,
                                isLast: sql`excluded.is_last`,
                                originalName: sql`excluded.original_name`,
                                size: sql`excluded.size`,
                                updatedAt: new Date()
                            }
                        });

                    return Ok(undefined);
                } catch {
                    return Err(SERVER_ERRORS.METADATA_UNAVAILABLE);
                }
            });
        }
    };
}
