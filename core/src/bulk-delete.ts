import { z } from 'zod';
import { AccountRequestSchema, Sha1HexSchema, Sha256HexSchema, WorkerCountSchema } from './models';

export const BulkDeleteChunkSchema = z.object({
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});
export const BulkDeleteFileSchema = z.tuple([
    z.string().min(1),
    Sha256HexSchema,
    Sha256HexSchema,
    z.array(z.tuple([z.string().min(1), Sha1HexSchema])).nonempty()
]);
export const BulkDeleteRequestSchema = AccountRequestSchema.extend({
    workers: WorkerCountSchema,
    files: z.array(BulkDeleteFileSchema).nonempty()
});
export const BulkDeletedChunkSchema = BulkDeleteChunkSchema.extend({
    trashedAt: z.int().nonnegative()
});
export const BulkDeleteFileEventSchema = z.object({
    type: z.literal('file'),
    index: z.int().nonnegative(),
    name: z.string().min(1),
    deleted: z.array(BulkDeletedChunkSchema),
    error: z.string().optional(),
    retryAfterSeconds: z.int().positive().optional()
});
export const BulkDeleteEventSchema = z.discriminatedUnion('type', [
    BulkDeleteFileEventSchema,
    z.object({ type: z.literal('done') })
]);

export type BulkDeleteChunk = z.infer<typeof BulkDeleteChunkSchema>;
export type BulkDeleteFile = {
    name: string;
    fileHash: string;
    fileId: string;
    chunks: BulkDeleteChunk[];
};
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequestSchema>;
export type BulkDeletedChunk = z.infer<typeof BulkDeletedChunkSchema>;
export type BulkDeleteFileEvent = z.infer<typeof BulkDeleteFileEventSchema>;
export type BulkDeleteEvent = z.infer<typeof BulkDeleteEventSchema>;
