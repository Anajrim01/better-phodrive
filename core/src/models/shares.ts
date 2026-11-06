import { z } from 'zod';
import { FileNameSchema, FolderPathSchema, Sha256HexSchema } from './files';

export const ShareKindSchema = z.enum(['file', 'folder']);
export const ShareStatusSchema = z.enum(['active', 'revoked']);

// Public manifests must not expose owner accounts, source file IDs or original parent paths.
export const ShareFileSchema = z.object({
    id: z.string().min(1),
    fileHash: Sha256HexSchema,
    name: FileNameSchema,
    relativeFolder: z.string().max(512),
    chunkCount: z.int().positive(),
    size: z.int().nonnegative()
});

export const ShareChunkSchema = z.object({
    index: z.int().nonnegative(),
    size: z.int().nonnegative(),
    isLast: z.boolean()
});

export const ShareChunkSessionSchema = z.object({
    url: z.url(),
    capability: z.string().min(1).max(4_096),
    expiresAt: z.iso.datetime(),
    chunk: ShareChunkSchema
});

export const ShareSummarySchema = z.object({
    id: z.string().min(1),
    kind: ShareKindSchema,
    name: z.string().min(1),
    status: ShareStatusSchema,
    fileCount: z.int().nonnegative(),
    createdAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    publicPath: z.string()
});

export const ShareListResponseSchema = z.object({
    shares: z.array(ShareSummarySchema)
});

export const ShareResponseSchema = z.object({
    share: ShareSummarySchema
});

const ShareContextSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('account'), id: z.string().min(1) }),
    z.object({ kind: z.literal('group'), id: z.string().min(1) })
]);

const ShareBaseSchema = z.object({
    requestKey: z.uuid(),
    name: z.string().trim().min(1).max(200),
    context: ShareContextSchema
});

export const FileShareRequestSchema = ShareBaseSchema.extend({
    kind: z.literal('file'),
    accountId: z.string().min(1),
    fileId: Sha256HexSchema
});

export const FolderShareRequestSchema = ShareBaseSchema.extend({
    kind: z.literal('folder'),
    folder: z.union([z.literal(''), FolderPathSchema])
});

export const CreateShareRequestSchema = z.discriminatedUnion('kind', [
    FileShareRequestSchema,
    FolderShareRequestSchema
]);

export const PublicShareSchema = z.object({
    name: z.string().min(1),
    kind: ShareKindSchema,
    createdAt: z.iso.datetime(),
    files: z.array(ShareFileSchema)
});

export type ShareKind = z.infer<typeof ShareKindSchema>;
export type ShareStatus = z.infer<typeof ShareStatusSchema>;
export type ShareFile = z.infer<typeof ShareFileSchema>;
export type ShareChunkSession = z.infer<typeof ShareChunkSessionSchema>;
export type ShareSummary = z.infer<typeof ShareSummarySchema>;
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;
export type PublicShare = z.infer<typeof PublicShareSchema>;
