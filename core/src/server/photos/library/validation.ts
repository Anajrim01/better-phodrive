import type { RemoteBmp } from '../../../models';

export function isRemoteBmp(value: unknown): value is RemoteBmp {
    if (!value || typeof value !== 'object') return false;

    const item = value as Record<string, unknown>;

    return (
        typeof item.fileHash === 'string' &&
        typeof item.fileId === 'string' &&
        typeof item.mediaKey === 'string' &&
        typeof item.sha1 === 'string' &&
        typeof item.size === 'number'
    );
}
