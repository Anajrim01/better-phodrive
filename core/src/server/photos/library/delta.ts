import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { SERVER_ERRORS, type ServerError } from '../../errors';
import type { Fetcher } from '../../fetcher';
import { readLibraryPage, type LibraryPage } from './page';
import { applyFolderHints } from './folder-hints';

export type DeltaResult = {
    items: RemoteBmp[];
    deleted: string[];
    trashed: string[];
    skipped: string[];
    syncToken: Buffer;
};

type PageRead = { page: LibraryPage } | { error: ServerError };

function pageRead(received: Result<LibraryPage, ServerError>): PageRead {
    return received.match<PageRead>({
        Ok: (page) => ({ page }),
        Err: (error) => ({ error })
    });
}

export function fetchDelta(
    email: string,
    token: string,
    syncToken: Buffer,
    fetcher: Fetcher
): AsyncResult<DeltaResult, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const deleted = new Set<string>();
        const trashed = new Set<string>();
        const skipped = new Set<string>();
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
            for (const mediaKey of read.page.trashedMediaKeys) trashed.add(mediaKey);
            for (const mediaKey of read.page.skippedMediaKeys) skipped.add(mediaKey);
            nextSyncToken ??= read.page.syncToken;
            pageToken = read.page.nextPageToken;
        } while (pageToken);

        applyFolderHints(items);

        return Ok({
            items: [...items.values()],
            deleted: [...deleted],
            trashed: [...trashed],
            skipped: [...skipped],
            syncToken: nextSyncToken ?? syncToken
        });
    });
}
