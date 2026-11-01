import { Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import type { ServerError } from '../../errors';
import type { DeltaResult } from './delta';
import { trimChangeLog, type LibraryAccountState } from './state';

export type DeltaApplyResult = {
    state: LibraryAccountState;
    shouldWrite: boolean;
};

/** Apply one delta page set, marking hidden chunks trashed and dropping permanent deletions. */
export function applyDelta(
    stored: LibraryAccountState,
    delta: DeltaResult,
    now = Date.now()
): AsyncResult<DeltaApplyResult, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map(stored.items);
        const changeItems = new Map<string, RemoteBmp>();
        for (const item of delta.items) {
            const existing = items.get(item.mediaKey);
            const merged =
                item.trashedAt !== undefined && existing
                    ? { ...existing, trashedAt: existing.trashedAt ?? item.trashedAt }
                    : item;
            items.set(merged.mediaKey, merged);
            changeItems.set(merged.mediaKey, merged);
        }

        const deleted = new Set(delta.deleted);
        for (const mediaKey of delta.deleted) items.delete(mediaKey);
        for (const mediaKey of delta.skipped) {
            if (items.delete(mediaKey)) deleted.add(mediaKey);
        }

        for (const mediaKey of delta.trashed) {
            const item = items.get(mediaKey);
            if (!item) continue;

            const trashed = { ...item, trashedAt: item.trashedAt ?? now };
            items.set(mediaKey, trashed);
            changeItems.set(mediaKey, trashed);
        }

        const changed = changeItems.size > 0 || deleted.size > 0;
        const nextRevision = changed ? stored.revision + 1 : stored.revision;
        const log = changed
            ? trimChangeLog([
                  ...stored.log,
                  {
                      revision: nextRevision,
                      at: now,
                      items: [...changeItems.values()],
                      deleted: [...deleted]
                  }
              ])
            : stored.log;
        const state: LibraryAccountState = {
            syncToken: delta.syncToken,
            revision: nextRevision,
            items,
            log
        };

        return Ok({ state, shouldWrite: changed });
    });
}
