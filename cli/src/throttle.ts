import type { AsyncResult, Result } from 'results-ts';
import { formatDuration } from '@madkarmaa/phodrive-core/browser/upload/eta';
import type { CliContext } from './context';
import { status } from './output';

const THROTTLE_RETRY_LIMIT = 3;

export type Throttled = { code: string; message: string; retryAfterSeconds?: number };

export function throttleMessage(seconds: number): string {
    return `Google is throttling requests. Retrying in about ${formatDuration(Math.max(1, seconds))}.`;
}

export async function waitForThrottle(context: CliContext, seconds: number): Promise<void> {
    status(context).warn(throttleMessage(seconds));
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1_000));
}

export async function retryThrottled<T, E extends Throttled>(
    context: CliContext,
    operation: () => AsyncResult<T, E>
): Promise<Result<T, E>> {
    for (let attempt = 1; ; attempt++) {
        const result = await operation();
        const failed = result.match<Throttled | null>({
            Ok: () => null,
            Err: (error) => error
        });
        if (!failed || failed.code !== 'THROTTLED' || attempt >= THROTTLE_RETRY_LIMIT)
            return result;

        await waitForThrottle(context, failed.retryAfterSeconds ?? 60);
    }
}
