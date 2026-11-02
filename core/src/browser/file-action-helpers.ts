import { FileActionKind } from '../models';
import type { FileGroup, UploadedChunk } from '../files';

export const INVALID_DELETE_RESPONSE = {
    code: 'INVALID_DELETE_RESPONSE',
    message: 'Invalid delete response.'
} as const;

export function chunksFor(item: FileGroup, action: FileActionKind): UploadedChunk[] {
    if (action === FileActionKind.Delete) return [...item.chunks, ...item.duplicates];
    if (action === FileActionKind.Restore)
        return item.trashed
            ? item.trashedChunks
            : item.trashedChunks.filter(
                  (trashed) =>
                      !item.chunks.some((active) => active.chunkIndex === trashed.chunkIndex)
              );
    if (action === FileActionKind.DeleteForever) return item.trashedChunks;

    return item.chunks;
}
