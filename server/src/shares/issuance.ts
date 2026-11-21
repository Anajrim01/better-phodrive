import { Err, Ok, type AsyncResult } from 'results-ts';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { ServerContext } from '../context';
import type { ShareError } from './repository';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const MAX_CONCURRENT = 2;
type Usage = { active: number; count: number; resetAt: number };
const contexts = new WeakMap<ServerContext, Map<string, Usage>>();

export function withIssuanceLimit<T>(
    context: ServerContext,
    accountId: string,
    run: () => AsyncResult<T, ShareError>
): AsyncResult<T, ShareError> {
    return Ok(undefined).andThenAsync(async () => {
        let accounts = contexts.get(context);
        if (!accounts) {
            accounts = new Map();
            contexts.set(context, accounts);
        }

        const now = Date.now();
        for (const [key, entry] of accounts)
            if (entry.active === 0 && entry.resetAt <= now) accounts.delete(key);

        let usage = accounts.get(accountId);
        if (!usage) {
            usage = { active: 0, count: 0, resetAt: now + WINDOW_MS };
            accounts.set(accountId, usage);
        }
        if (usage.resetAt <= now) {
            usage.count = 0;
            usage.resetAt = now + WINDOW_MS;
        }
        if (usage.count >= MAX_PER_WINDOW)
            return Err({
                ...SERVER_ERRORS.SHARE_BUSY,
                retryAfterSeconds: Math.max(1, Math.ceil((usage.resetAt - now) / 1000))
            });
        if (usage.active >= MAX_CONCURRENT)
            return Err({ ...SERVER_ERRORS.SHARE_BUSY, retryAfterSeconds: 1 });

        usage.active++;
        usage.count++;
        try {
            return await run();
        } finally {
            usage.active--;
        }
    });
}
