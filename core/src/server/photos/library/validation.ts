import type { RemoteBmp } from '../../../models';

export function isRemoteBmp(value: unknown): value is RemoteBmp {
    if (!value || typeof value !== 'object') return false;

    const item = value as Record<string, unknown>;

    return (
        typeof item.fileHash === 'string' &&
        typeof item.fileId === 'string' &&
        typeof item.mediaKey === 'string' &&
        typeof item.sha1 === 'string' &&
        typeof item.size === 'number' &&
        typeof item.chunkIndex === 'number' &&
        (item.chunkCount === undefined ||
            (typeof item.chunkCount === 'number' &&
                Number.isSafeInteger(item.chunkCount) &&
                item.chunkCount > 0)) &&
        typeof item.isLast === 'boolean' &&
        typeof item.at === 'number' &&
        (item.trashedAt === undefined ||
            (typeof item.trashedAt === 'number' &&
                Number.isSafeInteger(item.trashedAt) &&
                item.trashedAt >= 0))
    );
}
