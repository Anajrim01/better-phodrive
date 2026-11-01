import { z } from 'zod';
import { RemoteBmpSchema } from '../../../models';
import type { LibraryAccountState } from './state';

const PersistedChangeSchema = z.object({
    revision: z.int().nonnegative(),
    at: z.number(),
    items: z.array(RemoteBmpSchema),
    deleted: z.array(z.string().min(1))
});

const PersistedAccountSchema = z.object({
    syncToken: z.string().min(1),
    revision: z.int().nonnegative(),
    items: z.array(RemoteBmpSchema),
    log: z.array(PersistedChangeSchema)
});

/** Parse one persisted account; any invalid field discards the account. */
export function parseAccountState(value: unknown): LibraryAccountState | null {
    const parsed = PersistedAccountSchema.safeParse(value);
    if (!parsed.success) return null;

    return {
        syncToken: Buffer.from(parsed.data.syncToken, 'base64url'),
        revision: parsed.data.revision,
        items: new Map(parsed.data.items.map((item) => [item.mediaKey, item])),
        log: parsed.data.log
    };
}
