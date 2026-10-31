import { createHash } from 'node:crypto';
import { identityInput } from '../files';
import { MAX_CHUNK_PAYLOAD_BYTES } from './bmp/index';

/** Stable across retries; names and split layouts keep independent chunk groups. */
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
