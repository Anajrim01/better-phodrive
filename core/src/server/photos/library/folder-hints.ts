import type { RemoteBmp } from '../../../models';
import { MAX_CHUNK_PAYLOAD_BYTES } from '../../../bmp/format';
import { fileIdentity } from '../../chunks';

function folderKey(item: RemoteBmp): string | null {
    return item.originalName === undefined ? null : `${item.fileHash}\u0000${item.originalName}`;
}

/** Fill a trashed item's missing folder from a probed sibling on another page. */
export function applyFolderHints(items: Map<string, RemoteBmp>): void {
    const folders = new Map<string, string>();
    for (const item of items.values()) {
        const key = folderKey(item);
        if (key && item.folder) folders.set(key, item.folder);
    }

    for (const [mediaKey, item] of items) {
        if (item.trashedAt === undefined || item.folder !== undefined) continue;

        const key = folderKey(item);
        const folder = key ? folders.get(key) : undefined;
        if (!folder) continue;

        items.set(mediaKey, {
            ...item,
            folder,
            fileId: fileIdentity(
                item.originalName ?? '',
                item.fileHash,
                MAX_CHUNK_PAYLOAD_BYTES,
                folder
            )
        });
    }
}
