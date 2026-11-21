import { and, eq, inArray, sql } from 'drizzle-orm';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileLocationEdit, RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { Database } from './db/client';
import { chunkMetadata, fileLocation } from './db/schema';

const FILE_NOT_FOUND = {
    code: 'FILE_NOT_FOUND',
    message: 'One or more selected files could not be found in this Google account.',
    status: 404
} as const;

type LocationScope = { userId: string; googleAccountId: string; googleAccountEmail: string };
type LocationError = typeof FILE_NOT_FOUND | typeof SERVER_ERRORS.FILE_LOCATION_UNAVAILABLE;

/** A folder edit supplies an explicit set of files and their destinations. */
export function saveFileLocations(
    db: Database,
    { userId, googleAccountId, googleAccountEmail }: LocationScope,
    edits: readonly FileLocationEdit[]
): AsyncResult<void, LocationError> {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, LocationError>> => {
        try {
            return await db.transaction(async (tx) => {
                const known = await tx
                    .select({ mediaKey: chunkMetadata.mediaKey, fileId: chunkMetadata.fileId })
                    .from(chunkMetadata)
                    .where(
                        and(
                            eq(chunkMetadata.userId, userId),
                            eq(chunkMetadata.googleAccountId, googleAccountId),
                            eq(chunkMetadata.chunkIndex, 0),
                            inArray(
                                chunkMetadata.mediaKey,
                                edits.map((edit) => edit.mediaKey)
                            )
                        )
                    )
                    .for('share');
                const identities = new Map(known.map(({ mediaKey, fileId }) => [mediaKey, fileId]));
                if (edits.some(({ mediaKey, fileId }) => identities.get(mediaKey) !== fileId))
                    return Err(FILE_NOT_FOUND);

                // Lock overlapping upsert keys in the same order for concurrent folder edits.
                const rows = edits
                    .map(({ mediaKey, fileId, name, folder }) => ({
                        userId,
                        googleAccountEmail,
                        mediaKey,
                        fileId,
                        name,
                        folder
                    }))
                    .sort((first, second) => first.fileId.localeCompare(second.fileId));
                await tx
                    .insert(fileLocation)
                    .values(rows)
                    .onConflictDoUpdate({
                        target: [
                            fileLocation.userId,
                            fileLocation.googleAccountEmail,
                            fileLocation.mediaKey,
                            fileLocation.fileId
                        ],
                        set: {
                            name: sql`coalesce(excluded.name, ${fileLocation.name})`,
                            folder: sql`coalesce(excluded.folder, ${fileLocation.folder})`
                        }
                    });

                return Ok(undefined);
            });
        } catch {
            return Err(SERVER_ERRORS.FILE_LOCATION_UNAVAILABLE);
        }
    });
}

export function applyFileLocations(
    db: Database,
    userId: string,
    googleAccountEmail: string,
    items: RemoteBmp[]
): AsyncResult<RemoteBmp[], ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const mediaKeys = [
            ...new Set(items.filter((item) => item.chunkIndex === 0).map((item) => item.mediaKey))
        ];
        if (!mediaKeys.length) return Ok(items);

        try {
            const locations = await db
                .select()
                .from(fileLocation)
                .where(
                    and(
                        eq(fileLocation.userId, userId),
                        eq(fileLocation.googleAccountEmail, googleAccountEmail),
                        inArray(fileLocation.mediaKey, mediaKeys)
                    )
                );
            const byChunk = new Map(
                locations.map((location) => [`${location.fileId}:${location.mediaKey}`, location])
            );

            return Ok(
                items.map((item) => {
                    if (item.chunkIndex !== 0) return item;
                    const location = byChunk.get(`${item.fileId}:${item.mediaKey}`);
                    if (!location) return item;

                    return {
                        ...item,
                        ...(location.name !== null ? { displayName: location.name } : {}),
                        ...(location.folder !== null ? { displayFolder: location.folder } : {})
                    };
                })
            );
        } catch {
            return Err(SERVER_ERRORS.FILE_LOCATION_UNAVAILABLE);
        }
    });
}
