import { and, eq, inArray } from 'drizzle-orm';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { Database } from './db/client';
import { fileLocation } from './db/schema';

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
