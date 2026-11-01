import { SERVER_ERRORS, type ServerError } from '../../errors';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../../models';
import { photosFetch, type Fetcher } from '../../fetcher';
import { readLibraryPage } from './page';
import { readAccountRevision, readAccountState } from './state';

export { clearProbeCache, configureProbeCache, flushProbeCache } from './probe-cache';
export { clearLibraryState, configureLibraryState, flushLibraryState } from './state';
export { syncLibrary, type LibrarySyncResult } from './sync';

const MAX_PAGE_TOKEN_LENGTH = 8192;

export function listBmps(
    email: string,
    token: string,
    pageToken = '',
    fetcher: Fetcher = photosFetch
): AsyncResult<{ items: RemoteBmp[]; nextPageToken: string; revision: number }, ServerError> {
    const validated =
        pageToken.length > MAX_PAGE_TOKEN_LENGTH ||
        (pageToken && !/^[A-Za-z0-9_-]+$/.test(pageToken))
            ? Err(SERVER_ERRORS.INVALID_PAGE_TOKEN)
            : Ok(pageToken);

    const revision = readAccountRevision(email);

    return validated
        .andThenAsync(() => readLibraryPage(email, token, pageToken, undefined, fetcher))
        .map((page) => {
            const items = [...page.items];
            const seen = new Set(items.map((item) => item.mediaKey));
            const state = readAccountState(email);

            for (const mediaKey of page.trashedMediaKeys) {
                if (seen.has(mediaKey)) continue;

                const known = state?.items.get(mediaKey);
                if (!known) continue;

                items.push({ ...known, trashedAt: known.trashedAt ?? Date.now() });
                seen.add(mediaKey);
            }

            return {
                items,
                nextPageToken: page.nextPageToken,
                revision
            };
        });
}
