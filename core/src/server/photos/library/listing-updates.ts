import type { RemoteBmp } from '../../../models';
import { withListingFolder } from './overrides';
import { readAccountState, trimChangeLog, writeAccountState } from './state';

function sameListing(first: RemoteBmp, second: RemoteBmp): boolean {
    return (
        first.originalName === second.originalName &&
        (first.folder ?? '') === (second.folder ?? '') &&
        first.trashedAt === second.trashedAt
    );
}

/** Replace indexed listings and record one change entry for the whole batch. */
export function updateListingItems(
    email: string,
    items: readonly RemoteBmp[],
    now = Date.now()
): RemoteBmp[] {
    const state = readAccountState(email);
    if (!state) return [];

    const next = new Map(state.items);
    const changed: RemoteBmp[] = [];
    for (const raw of items) {
        const item = withListingFolder(raw, raw.folder ?? '');
        const existing = next.get(item.mediaKey);
        if (existing && sameListing(existing, item)) continue;

        next.set(item.mediaKey, item);
        changed.push(item);
    }
    if (changed.length === 0) return [];

    const revision = state.revision + 1;
    writeAccountState(email, {
        ...state,
        revision,
        items: next,
        log: trimChangeLog([...state.log, { revision, at: now, items: changed, deleted: [] }])
    });

    return changed;
}
