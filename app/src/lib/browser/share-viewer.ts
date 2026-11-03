import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { SHARE_BASE_URL } from '@madkarmaa/phodrive-core/share-models';
import { Ok, type AsyncResult } from 'results-ts';

const VIEWER_TIMEOUT_MS = 4000;

/** A deploy probe only: any reachable viewer origin can serve the owner share links. */
export function checkShareViewer(
    shareBaseUrl = SHARE_BASE_URL
): AsyncResult<boolean, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        let origin: string;

        try {
            origin = new URL(shareBaseUrl).origin;
        } catch {
            return Ok(false as const);
        }

        try {
            await fetch(origin, {
                method: 'HEAD',
                mode: 'no-cors',
                cache: 'no-store',
                signal: AbortSignal.timeout(VIEWER_TIMEOUT_MS)
            });

            return Ok(true as const);
        } catch {
            return Ok(false as const);
        }
    });
}
