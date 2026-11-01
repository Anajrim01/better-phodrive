import type { AsyncResult } from 'results-ts';
import type { ServerError } from './errors';
import { photosFetch, type Fetcher } from './fetcher';
import { authenticatedHeaders } from './photos/auth';

/** Confirm the request token before touching a cached index. */
export function verifyManageAccount(
    email: string,
    token: string,
    fetcher: Fetcher = photosFetch
): AsyncResult<void, ServerError> {
    return authenticatedHeaders(email, token, fetcher).map(() => undefined);
}
