import { z } from 'zod';
import { RemoteBmpSchema } from './models';

export const LibrarySyncResponseSchema = z.object({
    items: z.array(RemoteBmpSchema),
    deleted: z.array(z.string().min(1)),
    full: z.boolean(),
    revision: z.int().nonnegative()
});
export type LibrarySyncResponse = z.infer<typeof LibrarySyncResponseSchema>;
