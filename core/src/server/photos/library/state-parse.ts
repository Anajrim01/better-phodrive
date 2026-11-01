import type { RemoteBmp } from '../../../models';
import { isRemoteBmp } from './validation';
import type { LibraryAccountState, LibraryChange } from './state';

function parseItems(value: unknown): Map<string, RemoteBmp> {
    const items = new Map<string, RemoteBmp>();
    if (!Array.isArray(value)) return items;

    for (const item of value) {
        if (isRemoteBmp(item)) items.set(item.mediaKey, item);
    }

    return items;
}

function parseLog(value: unknown, revision: number): LibraryChange[] {
    const changes: LibraryChange[] = [];
    if (!Array.isArray(value)) return changes;

    let lastRevision = 0;
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') return [];

        const {
            revision: entryRevision,
            at,
            items: changed,
            deleted
        } = entry as {
            revision?: unknown;
            at?: unknown;
            items?: unknown;
            deleted?: unknown;
        };
        if (
            typeof entryRevision !== 'number' ||
            !Number.isSafeInteger(entryRevision) ||
            entryRevision <= lastRevision ||
            entryRevision > revision ||
            typeof at !== 'number' ||
            !Array.isArray(changed) ||
            !Array.isArray(deleted)
        )
            return [];

        const changedItems = changed.filter(isRemoteBmp);
        const deletedKeys = deleted.filter(
            (mediaKey): mediaKey is string => typeof mediaKey === 'string'
        );
        if (changedItems.length !== changed.length || deletedKeys.length !== deleted.length)
            return [];

        lastRevision = entryRevision;
        changes.push({ revision: entryRevision, at, items: changedItems, deleted: deletedKeys });
    }

    return changes;
}

/** Parse one persisted account, dropping fields that fail validation. */
export function parseAccountState(value: unknown): LibraryAccountState | null {
    if (!value || typeof value !== 'object') return null;

    const { syncToken, revision, items, log } = value as {
        syncToken?: unknown;
        revision?: unknown;
        items?: unknown;
        log?: unknown;
    };
    if (
        typeof syncToken !== 'string' ||
        !syncToken ||
        !Array.isArray(items) ||
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 0
    )
        return null;

    return {
        syncToken: Buffer.from(syncToken, 'base64url'),
        revision,
        items: parseItems(items),
        log: parseLog(log, revision)
    };
}
