import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { FileActionDeps } from '#browser/drive/file-action';
import type { DriveLibrary } from '#browser/drive/library.svelte';
import { markChunkRestored, markChunkTrashed, removeChunk } from '#browser/drive/library-chunks';

export type ChunkHandlers = Pick<FileActionDeps, 'onTrashed' | 'onRestored' | 'onRemoved'>;

export function chunkHandlers(library: DriveLibrary): ChunkHandlers {
    const assign = (chunks: UploadedChunk[]): void => {
        library.chunks = chunks;
    };

    return {
        onTrashed: (item, chunk) => {
            assign(markChunkTrashed(library.chunks, item, chunk));
        },
        onRestored: (item, chunk) => {
            assign(markChunkRestored(library.chunks, item, chunk));
        },
        onRemoved: (item, chunk) => {
            assign(removeChunk(library.chunks, item, chunk));
        }
    };
}
