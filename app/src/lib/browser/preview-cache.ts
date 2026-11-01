import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { PreviewMode } from '@madkarmaa/phodrive-core/models';
import type { PreviewPayload } from '#browser/preview';

const MAX_PREVIEW_CACHE_ENTRIES = 12;
const MAX_PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;

type CacheEntry = { value: PreviewPayload; bytes: number };

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function previewBytes(value: PreviewPayload): number {
    if (value.kind === 'image') return value.blob.size;
    if (value.kind === 'text') return value.text.length * 2;

    return 0;
}

export function previewCacheKey(item: FileGroup, mode: PreviewMode): string {
    const chunk = item.chunks[0];

    return `${item.fileHash}:${chunk?.sha1 ?? ''}:${chunk?.chunkIndex ?? 0}:${mode}`;
}

export function getCachedPreview(key: string): PreviewPayload | null {
    const entry = entries.get(key);
    if (!entry) return null;

    entries.delete(key);
    entries.set(key, entry);

    return entry.value;
}

export function cachePreview(key: string, value: PreviewPayload): void {
    const bytes = previewBytes(value);
    if (bytes > MAX_PREVIEW_CACHE_BYTES) return;

    const existing = entries.get(key);
    if (existing) {
        totalBytes -= existing.bytes;
        entries.delete(key);
    }

    entries.set(key, { value, bytes });
    totalBytes += bytes;

    for (const [oldKey, entry] of entries) {
        if (entries.size <= MAX_PREVIEW_CACHE_ENTRIES && totalBytes <= MAX_PREVIEW_CACHE_BYTES)
            break;
        if (oldKey === key) continue;

        entries.delete(oldKey);
        totalBytes -= entry.bytes;
    }
}

export function clearPreviewCache(): void {
    entries.clear();
    totalBytes = 0;
}
