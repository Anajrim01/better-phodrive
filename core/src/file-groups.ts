import type { RemoteBmp } from './models';

export type UploadedChunk = RemoteBmp & { email: string };

export type FileGroup = {
    email: string;
    accountId?: string;
    fileHash: string;
    fileId: string;
    name: string;
    folder: string;
    at: number;
    chunkCount: number | null;
    chunks: UploadedChunk[];
    complete: boolean;
    /** Every known chunk is in Google Photos trash. */
    trashed?: boolean;
    /** Trashed siblings of a file that still has active chunks. */
    trashedChunks?: UploadedChunk[];
};

type IndexedFileGroup = {
    file: FileGroup;
    chunkPositions?: Map<number, number>;
};

function chunksAreComplete(chunks: readonly UploadedChunk[], count: number | null): boolean {
    return (
        count !== null &&
        chunks.length === count &&
        chunks.every((chunk, index) => chunk.chunkIndex === index)
    );
}

/** The direct-token CLI library has no server account id, so email remains its owner key. */
export function ownerKey(file: { email: string; accountId?: string }): string {
    return file.accountId ?? file.email;
}

export function fileKey(file: { email: string; fileId: string; accountId?: string }): string {
    return `${ownerKey(file)}:${file.fileId}`;
}

export function groupChunks(items: UploadedChunk[]): FileGroup[] {
    const groups = new Map<string, IndexedFileGroup>();

    for (const chunk of items) {
        const key = fileKey(chunk);
        const entry = groups.get(key);

        if (!entry) {
            const file: FileGroup = {
                email: chunk.email,
                ...(chunk.accountId ? { accountId: chunk.accountId } : {}),
                fileHash: chunk.fileHash,
                fileId: chunk.fileId,
                name: chunk.originalName ?? `File ${chunk.fileHash.slice(0, 12)}`,
                folder: chunk.folder ?? '',
                at: chunk.at,
                chunkCount: null,
                chunks: [chunk],
                complete: false
            };
            groups.set(key, { file });

            continue;
        }

        const group = entry.file;
        let position: number | undefined;
        if (entry.chunkPositions) {
            position = entry.chunkPositions.get(chunk.chunkIndex);
        } else if (group.chunks[0].chunkIndex === chunk.chunkIndex) {
            position = 0;
        }

        const current = position === undefined ? undefined : group.chunks[position];
        group.at = Math.max(group.at, chunk.at);
        if (current && current.at > chunk.at) continue;

        if (position === undefined) {
            // Single-chunk files need no map. Positions stay valid until the final sort.
            entry.chunkPositions ??= new Map([[group.chunks[0].chunkIndex, 0]]);
            entry.chunkPositions.set(chunk.chunkIndex, group.chunks.length);
            group.chunks.push(chunk);
        } else {
            group.chunks[position] = chunk;
        }

        if (chunk.chunkIndex === 0) {
            if (chunk.originalName) group.name = chunk.originalName;
            group.folder = chunk.folder ?? '';
        }
    }

    return [...groups.values()].map(({ file: group }) => {
        group.chunks.sort((first, second) => first.chunkIndex - second.chunkIndex);

        const last = group.chunks.find((chunk) => chunk.isLast);
        group.chunkCount = last ? last.chunkIndex + 1 : null;
        group.complete = chunksAreComplete(group.chunks, group.chunkCount);

        return group;
    });
}

/** Split grouped chunks into the active Files view and the Trash view. */
export function partitionFileGroups(items: UploadedChunk[]): {
    files: FileGroup[];
    trash: FileGroup[];
} {
    const files: FileGroup[] = [];
    const trash: FileGroup[] = [];

    for (const group of groupChunks(items)) {
        const trashedChunks = group.chunks.filter((chunk) => chunk.trashed);
        if (!trashedChunks.length) {
            files.push(group);
            continue;
        }

        const chunks = group.chunks.filter((chunk) => !chunk.trashed);
        if (!chunks.length) {
            trash.push({ ...group, trashed: true });
            continue;
        }

        files.push({
            ...group,
            chunks,
            complete: chunksAreComplete(chunks, group.chunkCount),
            trashedChunks
        });
    }

    return { files, trash };
}
