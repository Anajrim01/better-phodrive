import { createHash } from 'node:crypto';
import { MAX_CHUNK_PAYLOAD_BYTES } from './bmp/index';
import { identityInput } from '../files';

/** Stable across retries; names, split layouts, and folders keep independent chunk groups. */
export function fileIdentity(
    name: string,
    fileHash: string,
    chunkPayloadBytes = MAX_CHUNK_PAYLOAD_BYTES,
    folder = ''
): string {
    return createHash('sha256')
        .update(identityInput(name, fileHash, chunkPayloadBytes, folder))
        .digest('hex');
}

export function chunkFileName(
    name: string,
    fileHash: string,
    chunkIndex: number,
    chunkCount: number
): string {
    return `${name}.phodrive-${fileHash}-${chunkIndex}-of-${chunkCount}.bmp`;
}
