import type { RemoteBmp } from './models';

type ChunkShape = Pick<RemoteBmp, 'chunkIndex' | 'chunkCount' | 'isLast'>;

/** The declared chunk total, or the last chunk position for legacy chunks. */
export function expectedChunks(chunks: readonly ChunkShape[]): number | null {
    let expected = 0;
    for (const chunk of chunks) {
        if (chunk.chunkCount !== undefined) expected = Math.max(expected, chunk.chunkCount);
        if (chunk.isLast) expected = Math.max(expected, chunk.chunkIndex + 1);
    }

    return expected > 0 ? expected : null;
}

export function missingChunks(chunks: readonly ChunkShape[], expected: number): number {
    const present = new Set(chunks.map((chunk) => chunk.chunkIndex));

    return expected - [...present].filter((index) => index < expected).length;
}

export function incompleteChunkMessage(total: number, missing: number): string {
    return `${missing} of ${total} chunk${total === 1 ? '' : 's'} ${
        missing === 1 ? 'is' : 'are'
    } missing. This file cannot be downloaded.`;
}

export function incompleteFileMessage(file: {
    chunkCount: number | null;
    chunks: readonly ChunkShape[];
}): string {
    if (file.chunkCount === null) return 'This file has missing chunks and cannot be downloaded.';

    return incompleteChunkMessage(file.chunkCount, missingChunks(file.chunks, file.chunkCount));
}
