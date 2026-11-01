import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { readLibraryPage, type LibraryPage } from './page';
import {
    deleteAccountState,
    readAccountState,
    updateAccountSyncToken,
    writeAccountState
} from './state';

export type LibrarySyncResult = {
    items: RemoteBmp[];
    deleted: string[];
    full: boolean;
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

function applyFullSync(
    email: string,
    token: string,
    fetcher: Fetcher
): AsyncResult<LibrarySyncResult, ServerError> {
    return fetchFullSync(email, token, fetcher).map((value) => {
        if (value.syncToken) writeAccountState(email, value.syncToken, value.items);
        else deleteAccountState(email);

        return { items: value.items, deleted: [], full: true };
    });
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

/** Apply the changes since the last stored sync, or rebuild the index from a full read. */
export function syncLibrary(
    email: string,
    token: string,
    force = false,
    fetcher: Fetcher = photosFetch
): AsyncResult<LibrarySyncResult, ServerError> {
    return Ok(undefined).andThenAsync(() =>
        withAccountLock(email.toLowerCase(), async () => {
            const stored = force ? undefined : readAccountState(email);
            if (!stored) return await applyFullSync(email, token, fetcher);

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

                return await applyFullSync(email, token, fetcher);
            }

            const indexChanged =
                read.value.items.length > 0 ||
                read.value.deleted.some((mediaKey) => stored.items.has(mediaKey));

            if (!indexChanged) {
                updateAccountSyncToken(email, read.value.syncToken);

                return Ok({ items: [], deleted: read.value.deleted, full: false });
            }

            const items = new Map(stored.items);
            for (const item of read.value.items) items.set(item.mediaKey, item);
            for (const mediaKey of read.value.deleted) items.delete(mediaKey);

            writeAccountState(email, read.value.syncToken, items.values());

            return Ok({
                items: read.value.items,
                deleted: read.value.deleted,
                full: false
            });
        })
    );
}
