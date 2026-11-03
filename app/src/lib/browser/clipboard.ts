import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { Ok, type AsyncResult } from 'results-ts';

export type CopyOutcome = 'copied' | 'manual';

/** Clipboard access needs permission and a secure context, so failing over is normal. */
export function copyText(text: string): AsyncResult<CopyOutcome, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText)
            return Ok('manual' as const);

        try {
            await navigator.clipboard.writeText(text);

            return Ok('copied' as const);
        } catch {
            return Ok('manual' as const);
        }
    });
}
