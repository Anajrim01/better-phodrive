import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { DraftSource, ShareError } from './repository';

export const MAX_SHARE_FILES = 500;
export const MAX_SHARE_CHUNKS = 2048;
export const MAX_MANIFEST_BYTES = 256 * 1024;

export function checkSnapshotLimits(
    name: string,
    sources: readonly DraftSource[]
): Result<void, ShareError> {
    const files = sources.flatMap((source) => source.files);
    const chunks = files.reduce((count, { snapshot }) => count + snapshot.file.chunks.length, 0);
    if (files.length > MAX_SHARE_FILES || chunks > MAX_SHARE_CHUNKS)
        return Err(SERVER_ERRORS.SHARE_LIMIT_EXCEEDED);

    const manifest = {
        name,
        kind: 'folder',
        createdAt: '0000-00-00T00:00:00.000Z',
        files: files.map(({ snapshot: { file, size }, relativeFolder }) => ({
            id: '00000000-0000-0000-0000-000000000000',
            fileHash: file.fileHash,
            name: file.name,
            relativeFolder,
            chunkCount: file.chunks.length,
            size
        }))
    };

    return Buffer.byteLength(JSON.stringify(manifest)) <= MAX_MANIFEST_BYTES
        ? Ok(undefined)
        : Err(SERVER_ERRORS.SHARE_LIMIT_EXCEEDED);
}
