import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { readLibraryPage, type LibraryPage } from './page';
import {
    LIBRARY_STATE_LOG_MAX_AGE_MS,
    deleteAccountState,
    readAccountState,
    trimChangeLog,
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
): AsyncResult<{ items: RemoteBmp[]; syncToken?: Buffer }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
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
            syncToken ??= read.page.syncToken;
            pageToken = read.page.nextPageToken;
        } while (pageToken);

        return Ok({ items: [...items.values()], ...(syncToken ? { syncToken } : {}) });
    });
}

function fetchDelta(
    email: string,
    token: string,
    syncToken: Buffer,
    fetcher: Fetcher
): AsyncResult<{ items: RemoteBmp[]; deleted: string[]; syncToken: Buffer }, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const deleted = new Set<string>();
        const pages = new Set<string>();
        let pageToken = '';
        let nextSyncToken: Buffer | undefined;

        do {
            if (pages.has(pageToken)) return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);
            pages.add(pageToken);

            const received = await readLibraryPage(email, token, pageToken, syncToken, fetcher);
            const read = pageRead(received);
            if ('error' in read) return Err(read.error);

            for (const item of read.page.items) items.set(item.mediaKey, item);
            for (const mediaKey of read.page.deletedMediaKeys) deleted.add(mediaKey);
            nextSyncToken ??= read.page.syncToken;
            pageToken = read.page.nextPageToken;
        } while (pageToken);

        return Ok({
            items: [...items.values()],
            deleted: [...deleted],
            syncToken: nextSyncToken ?? syncToken
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
    fetcher: Fetcher
): AsyncResult<LibrarySyncResult, ServerError> {
    return fetchFullSync(email, token, fetcher).map((value) => {
        if (!value.syncToken) {
            deleteAccountState(email);

            return fullResult(revision, value.items);
        }

        const state: LibraryAccountState = {
            syncToken: value.syncToken,
            revision,
            items: new Map(value.items.map((item) => [item.mediaKey, item])),
            log: []
        };
        writeAccountState(email, state);

        return fullResult(revision, value.items);
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
                return await applyFullSync(email, token, (previous?.revision ?? 0) + 1, fetcher);

            const received = await fetchDelta(email, token, stored.syncToken, fetcher);
            const read = received.match<
                | { value: { items: RemoteBmp[]; deleted: string[]; syncToken: Buffer } }
                | { error: ServerError }
            >({
                Ok: (value) => ({ value }),
                Err: (error) => ({ error })
            });
            if ('error' in read) {
                if (!rejectedState(read.error)) return Err(read.error);

                deleteAccountState(email);

                return await applyFullSync(email, token, stored.revision + 1, fetcher);
            }

            const indexChanged =
                read.value.items.length > 0 ||
                read.value.deleted.some((mediaKey) => stored.items.has(mediaKey));

            if (!indexChanged) {
                updateAccountSyncToken(email, read.value.syncToken);

                return Ok(revisionResult(stored, revision));
            }

            const items = new Map(stored.items);
            for (const item of read.value.items) items.set(item.mediaKey, item);
            for (const mediaKey of read.value.deleted) items.delete(mediaKey);

            const nextRevision = stored.revision + 1;
            const state: LibraryAccountState = {
                syncToken: read.value.syncToken,
                revision: nextRevision,
                items,
                log: trimChangeLog([
                    ...stored.log,
                    {
                        revision: nextRevision,
                        at: Date.now(),
                        items: read.value.items,
                        deleted: read.value.deleted
                    }
                ])
            };
            writeAccountState(email, state);

            return Ok(revisionResult(state, revision));
        })
    );
}
