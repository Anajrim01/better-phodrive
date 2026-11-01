import { Ok, type AsyncResult } from 'results-ts';
import type { ServerError } from '../../errors';
import { photosFetch, type Fetcher } from '../../fetcher';
import { readAccountState } from './state';
import { syncLibrary } from './sync';

/** Build the complete index before an edit so folder changes cannot miss unloaded files. */
export function ensureAccountIndex(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    if (readAccountState(email)) return Ok(undefined).andThenAsync(async () => Ok(undefined));

    return refreshAccountIndex(email, token, fetcher);
}

/** Rebuild a stale index when an edit names a file the cached listing does not contain. */
export function refreshAccountIndex(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return syncLibrary(email, token, true, 0, fetcher).map(() => undefined);
}
