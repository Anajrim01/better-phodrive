import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { applyDelta } from './apply-delta';
import { fetchDelta, type DeltaResult } from './delta';
import { readLibraryPage, type LibraryPage } from './page';
import {
    LIBRARY_STATE_LOG_MAX_AGE_MS,
    deleteAccountState,
    readAccountState,
    updateAccountSyncToken,
    writeAccountState,
    type LibraryAccountState
} from './state';

export type LibrarySyncResult = {
    items: RemoteBmp[];
    deleted: string[];
    full: boolean;
    revision: number;
};

type PageRead = { page: LibraryPage } | { error: ServerError };

function pageRead(received: Result<LibraryPage, ServerError>): PageRead {
    return received.match<PageRead>({
        Ok: (page) => ({ page }),
        Err: (error) => ({ error })
    });
}

function rejectedState(error: ServerError): boolean {
    return error.code === 'LIBRARY_SYNC_REJECTED';
}

function fetchFullSync(
    email: string,
    token: string,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; trashed: string[]; syncToken?: Buffer }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const trashed = new Set<string>();
        const pages = new Set<string>();
        let pageToken = '';
        let syncToken: Buffer | undefined;

        do {
            if (pages.has(pageToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);
            pages.add(pageToken);

            const received = await readLibraryPage(email, token, pageToken, undefined, fetcher);
            const read = pageRead(received);
            if ('error' in read) return Err(read.error);

            for (const item of read.page.items) items.set(item.mediaKey, item);
            for (const mediaKey of read.page.trashedMediaKeys) trashed.add(mediaKey);
            syncToken ??= read.page.syncToken;
            pageToken = read.page.nextPageToken;
        } while (pageToken);

        return Ok({
            items: [...items.values()],
            trashed: [...trashed],
            ...(syncToken ? { syncToken } : {})
        });
    });
}

function fullResult(revision: number, items: Iterable<RemoteBmp>): LibrarySyncResult {
    return { items: [...items], deleted: [], full: true, revision };
}

function applyFullSync(
    email: string,
    token: string,
    revision: number,
    fetcher: Fetcher,
    previous?: LibraryAccountState
): AsyncResult<LibrarySyncResult, ServerError> {
    return fetchFullSync(email, token, fetcher).map((value) => {
        if (!value.syncToken) {
            deleteAccountState(email);

            return fullResult(revision, value.items);
        }

        const items = new Map(value.items.map((item) => [item.mediaKey, item]));
        const now = Date.now();
        for (const [mediaKey, item] of items) {
            if (item.trashedAt === undefined) continue;

            const known = previous?.items.get(mediaKey);
            if (known)
                items.set(mediaKey, { ...known, trashedAt: known.trashedAt ?? item.trashedAt });
        }
        for (const mediaKey of value.trashed) {
            if (items.has(mediaKey)) continue;

            const known = previous?.items.get(mediaKey);
            if (known) items.set(mediaKey, { ...known, trashedAt: known.trashedAt ?? now });
        }

        const state: LibraryAccountState = {
            syncToken: value.syncToken,
            revision,
            items,
            log: []
        };
        writeAccountState(email, state);

        return fullResult(revision, [...items.values()]);
    });
}

function changesSince(
    state: LibraryAccountState,
    cursor: number
): { items: RemoteBmp[]; deleted: string[] } | null {
    if (cursor <= 0 || cursor > state.revision) return null;
    if (cursor === state.revision) return { items: [], deleted: [] };

    const now = Date.now();
    const entries = state.log.filter(
        (entry) => entry.revision > cursor && now - entry.at <= LIBRARY_STATE_LOG_MAX_AGE_MS
    );
    if (entries.length === 0) return null;
    if (cursor < entries[0].revision - 1) return null;

    const items = new Map<string, RemoteBmp>();
    const deleted = new Set<string>();
    for (const entry of entries) {
        for (const item of entry.items) {
            items.set(item.mediaKey, item);
            deleted.delete(item.mediaKey);
        }
        for (const mediaKey of entry.deleted) {
            deleted.add(mediaKey);
            items.delete(mediaKey);
        }
    }

    return { items: [...items.values()], deleted: [...deleted] };
}

function revisionResult(state: LibraryAccountState, cursor: number): LibrarySyncResult {
    const changes = changesSince(state, cursor);
    if (!changes) return fullResult(state.revision, state.items.values());

    return {
        items: changes.items,
        deleted: changes.deleted,
        full: false,
        revision: state.revision
    };
}

const syncLocks = new Map<string, Promise<unknown>>();

function withAccountLock<T>(email: string, task: () => Promise<T>): Promise<T> {
    const previous = syncLocks.get(email) ?? Promise.resolve();
    const run = previous.then(task, task);
    syncLocks.set(
        email,
        run.catch(() => undefined)
    );

    return run;
}

/** Apply Google's changes, then answer this client from the persisted change log. */
export function syncLibrary(
    email: string,
    token: string,
    force = false,
    revision = 0,
    fetcher: Fetcher = photosFetch
): AsyncResult<LibrarySyncResult, ServerError> {
    return Ok(undefined).andThenAsync(() =>
        withAccountLock(email.toLowerCase(), async () => {
            const previous = readAccountState(email);
            const stored = force ? undefined : previous;
            if (!stored)
                return await applyFullSync(
                    email,
                    token,
                    previous ? previous.revision + 1 : Date.now(),
                    fetcher,
                    previous
                );

            const received = await fetchDelta(email, token, stored.syncToken, fetcher);
            const read = received.match<{ value: DeltaResult } | { error: ServerError }>({
                Ok: (value) => ({ value }),
                Err: (error) => ({ error })
            });
            if ('error' in read) {
                if (!rejectedState(read.error)) return Err(read.error);

                deleteAccountState(email);

                return await applyFullSync(email, token, stored.revision + 1, fetcher, stored);
            }

            const applied = await applyDelta(stored, read.value);
            if (applied.isErr()) return Err(applied.unwrapErr());

            const { state, shouldWrite } = applied.unwrap();
            if (shouldWrite) writeAccountState(email, state);
            else updateAccountSyncToken(email, state.syncToken);

            return Ok(revisionResult(state, revision));
        })
    );
}
