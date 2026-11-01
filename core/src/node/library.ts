import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { FileGroup } from '../files';
import { partitionFileGroups } from '../trash';
import type { RemoteBmp } from '../models';
import type { Fetcher } from '../server/fetcher';
import { SERVER_ERRORS, type ServerError } from '../server/errors';
import { listBmps } from '../server/photos/index';

/** Read every library page and return the main list without fully trashed files. */
export function readLibrary(
    email: string,
    token: string,
    fetcher?: Fetcher
): AsyncResult<FileGroup[], ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const items = new Map<string, RemoteBmp>();
        const pageTokens = new Set<string>();
        let nextPageToken = '';

        do {
            pageTokens.add(nextPageToken);

            const received = await listBmps(email, token, nextPageToken, fetcher);

            const merged = received.andThen((page): Result<void, ServerError> => {
                if (page.nextPageToken && pageTokens.has(page.nextPageToken))
                    return Err(SERVER_ERRORS.REPEATED_LIBRARY_PAGE);

                for (const item of page.items) items.set(item.mediaKey, item);
                nextPageToken = page.nextPageToken;

                return Ok(undefined);
            });
            if (merged.isErr()) return merged;
        } while (nextPageToken);

        const chunks = [...items.values()].map((item) => ({ ...item, email }));

        return Ok(partitionFileGroups(chunks).files);
    });
}
