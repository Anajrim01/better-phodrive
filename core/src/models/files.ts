import { z } from 'zod';
import { AccountRequestSchema } from './accounts';
import { WorkerCountSchema } from './settings';

export enum FileActionKind {
    Download = 'download',
    Delete = 'delete',
    Restore = 'restore',
    DeleteForever = 'delete-forever'
}

/** Names become path segments and multipart filenames, so separators and controls are unsafe. */
export const FileNameSchema = z
    .string()
    .min(1)
    .refine((name) => !/[\\/\r\n\0]/.test(name));

export const MAX_FOLDER_PATH_LENGTH = 512;
export const MAX_FOLDER_SEGMENT_LENGTH = 255;

/** A relative slash-separated folder path. Root is the empty string and is stored by omission. */
export const FolderPathSchema = z
    .string()
    .min(1)
    .max(MAX_FOLDER_PATH_LENGTH)
    .refine((path) =>
        path
            .split('/')
            .every(
                (segment) =>
                    segment.length > 0 &&
                    segment.length <= MAX_FOLDER_SEGMENT_LENGTH &&
                    segment !== '.' &&
                    segment !== '..' &&
                    !/[\\\r\n\0]/.test(segment)
            )
    );

export const FileSizeSchema = z.int().nonnegative();

export const Sha1HexSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const SplitHeaderSchema = z
    .object({
        fileHash: Sha256HexSchema,
        fileId: Sha256HexSchema,
        chunkIndex: z.int().nonnegative(),
        flags: z.union([z.literal(0), z.literal(1)]),
        payloadSize: z.int().nonnegative(),
        fileName: z.string().min(1).optional(),
        folder: FolderPathSchema.optional()
    })
    .refine((header) => header.chunkIndex !== 0 || header.fileName !== undefined)
    .refine((header) => header.chunkIndex === 0 || header.folder === undefined);

const RemoteBmpObjectSchema = z.object({
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunkIndex: z.int().nonnegative(),
    isLast: z.boolean(),
    originalName: z.string().min(1).optional(),
    folder: FolderPathSchema.optional(),
    size: z.number().nonnegative(),
    at: z.int().nonnegative(),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema,
    accountId: z.string().min(1).optional(),
    /** Google reports this media item as trashed. Absent means active. */
    trashed: z.boolean().optional()
});

export const RemoteBmpSchema = RemoteBmpObjectSchema.refine(
    (chunk) => chunk.chunkIndex === 0 || chunk.folder === undefined
);

export const LibraryResponseSchema = z.object({
    items: z.array(RemoteBmpSchema),
    nextPageToken: z.string()
});

export const ErrorResponseSchema = z.object({ error: z.string() });

/** HTTP clients send no credentials; the server adds the signed-in user's account. */
export const LibraryPageRequestSchema = z.object({ pageToken: z.string().optional() });

export const FileActionRequestSchema = z.object({
    action: z.enum(FileActionKind),
    name: z.string().min(1),
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunks: z.array(RemoteBmpSchema).nonempty(),
    workers: WorkerCountSchema
});

export const FileRequestSchema = AccountRequestSchema.extend(FileActionRequestSchema.shape);

export const FileMutationResponseSchema = z.object({
    applied: z.array(RemoteBmpSchema),
    error: z.string().optional(),
    retryAfterSeconds: z.int().positive().optional()
});

/** Identifies one stored chunk for a raw download. */
export const ChunkReferenceSchema = RemoteBmpObjectSchema.pick({ mediaKey: true, sha1: true });

export type RemoteBmp = z.infer<typeof RemoteBmpSchema>;

export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export type SplitHeader = z.infer<typeof SplitHeaderSchema>;

export type FileActionRequest = z.infer<typeof FileActionRequestSchema>;

export type FileRequest = z.infer<typeof FileRequestSchema>;
