import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { parseChunkPrefix, isSplitChunk, type ChunkHeader } from './bmp';
import type { AlbumItem } from './api';
import { viewerFailure, type ViewerFailure } from './errors';
import { sanitizeFileName, sanitizeFolderPath } from './file-name';
import { MAX_FILE_BYTES, PROBE_CONCURRENCY } from './limits';
import type { Manifest, ManifestFile } from './manifest';

export interface ChunkCandidate {
    item: AlbumItem;
    header: ChunkHeader;
}

export interface PlannedFile {
    id: string;
    name: string;
    folder?: string;
    fileHash: string;
    chunks: ChunkCandidate[];
    size: number;
    compressed: boolean;
}

export type ProbeItem = (item: AlbumItem) => AsyncResult<Uint8Array, ViewerFailure>;

async function mapLimit<T, R>(
    items: T[],
    limit: number,
    work: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;

            results[index] = await work(items[index]);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);

    return results;
}

function candidatesFor(
    file: ManifestFile,
    group: ChunkCandidate[] | undefined
): Result<PlannedFile, ViewerFailure> {
    if (!group || group.length === 0)
        return Err(viewerFailure('share_incomplete', 'A file is missing from the album.'));

    if (group.length !== file.chunks)
        return Err(
            viewerFailure(
                'share_incomplete',
                `Expected ${file.chunks} chunks, found ${group.length}.`
            )
        );

    const chunks = [...group].sort(
        (first, second) => first.header.chunkIndex - second.header.chunkIndex
    );
    const first = chunks[0];

    for (const [index, chunk] of chunks.entries()) {
        if (chunk.header.chunkIndex !== index)
            return Err(viewerFailure('share_incomplete', 'Chunk order has a gap.'));
        if (chunk.header.fileHash !== first.header.fileHash)
            return Err(viewerFailure('chunk_invalid', 'Chunks do not belong to the same file.'));

        const isLast = index === chunks.length - 1;
        if (chunk.header.last !== isLast)
            return Err(viewerFailure('share_incomplete', 'The final chunk marker is missing.'));
    }

    if (!first.header.fileName || first.header.chunkIndex !== 0)
        return Err(viewerFailure('chunk_invalid', 'The first chunk has no file name.'));

    let size = 0;
    let compressed = false;
    for (const chunk of chunks) {
        const header = chunk.header;
        compressed ||= header.compressed;
        size += header.compressed ? (header.originalSize ?? 0) : header.payloadSize;
    }

    if (size > MAX_FILE_BYTES)
        return Err(viewerFailure('too_large', 'This file is too large to save.'));

    const plan: PlannedFile = {
        id: file.id,
        name: sanitizeFileName(first.header.fileName),
        fileHash: first.header.fileHash,
        chunks,
        size,
        compressed
    };
    if (first.header.folder) plan.folder = sanitizeFolderPath(first.header.folder);

    return Ok(plan);
}

export function discoverFiles(
    items: AlbumItem[],
    manifest: Manifest,
    probe: ProbeItem
): AsyncResult<PlannedFile[], ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => {
        const probes = await mapLimit(items, PROBE_CONCURRENCY, async (item) => {
            const bytes = await probe(item);
            return bytes.andThen((value) => {
                if (!isSplitChunk(value)) return Ok(null);

                return parseChunkPrefix(value).map((header) => ({ item, header }));
            });
        });

        const groups = new Map<string, ChunkCandidate[]>();
        for (const result of probes) {
            if (result.isErr()) return result;

            for (const candidate of result.iter()) {
                if (!candidate) continue;

                const group = groups.get(candidate.header.fileId) ?? [];
                group.push(candidate);
                groups.set(candidate.header.fileId, group);
            }
        }

        const files: PlannedFile[] = [];
        for (const file of manifest.files) {
            const planned = candidatesFor(file, groups.get(file.id));
            if (planned.isErr()) return planned;

            for (const value of planned.iter()) files.push(value);
        }

        return Ok(files);
    });
}
