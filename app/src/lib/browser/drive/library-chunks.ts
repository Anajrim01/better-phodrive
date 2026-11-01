import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';

function matches(saved: UploadedChunk, item: FileGroup, chunk: UploadedChunk): boolean {
    return (
        saved.email === item.email && saved.mediaKey === chunk.mediaKey && saved.sha1 === chunk.sha1
    );
}

export function markChunkTrashed(
    chunks: UploadedChunk[],
    item: FileGroup,
    chunk: UploadedChunk
): UploadedChunk[] {
    return chunks.map((saved) =>
        matches(saved, item, chunk) ? { ...saved, trashedAt: chunk.trashedAt ?? Date.now() } : saved
    );
}

export function markChunkRestored(
    chunks: UploadedChunk[],
    item: FileGroup,
    chunk: UploadedChunk
): UploadedChunk[] {
    return chunks.map((saved) =>
        matches(saved, item, chunk) ? { ...saved, trashedAt: undefined } : saved
    );
}

export function removeChunk(
    chunks: UploadedChunk[],
    item: FileGroup,
    chunk: UploadedChunk
): UploadedChunk[] {
    return chunks.filter((saved) => !matches(saved, item, chunk));
}
