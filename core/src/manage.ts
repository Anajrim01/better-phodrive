import { z } from 'zod';
import {
    AccountRequestSchema,
    FileNameSchema,
    FolderPathSchema,
    RemoteBmpSchema,
    Sha256HexSchema,
    WorkerCountSchema
} from './models';

export enum FileManageAction {
    Rename = 'rename',
    Move = 'move'
}

export enum FolderManageAction {
    Rename = 'rename',
    Move = 'move',
    MoveContents = 'move-contents',
    Delete = 'delete'
}

export const FileManageRequestSchema = z.discriminatedUnion('action', [
    AccountRequestSchema.extend({
        action: z.literal(FileManageAction.Rename),
        fileId: Sha256HexSchema,
        name: FileNameSchema
    }),
    AccountRequestSchema.extend({
        action: z.literal(FileManageAction.Move),
        fileId: Sha256HexSchema,
        folder: z.union([FolderPathSchema, z.literal('')])
    })
]);

export const FolderManageRequestSchema = z.discriminatedUnion('action', [
    AccountRequestSchema.extend({
        action: z.literal(FolderManageAction.Rename),
        folder: FolderPathSchema,
        name: FileNameSchema
    }),
    AccountRequestSchema.extend({
        action: z.literal(FolderManageAction.Move),
        folder: FolderPathSchema,
        destination: z.union([FolderPathSchema, z.literal('')])
    }),
    AccountRequestSchema.extend({
        action: z.literal(FolderManageAction.MoveContents),
        folder: FolderPathSchema
    }),
    AccountRequestSchema.extend({
        action: z.literal(FolderManageAction.Delete),
        folder: FolderPathSchema,
        workers: WorkerCountSchema
    })
]);

export const FolderFailureSchema = z.object({
    fileId: Sha256HexSchema,
    name: z.string().min(1),
    message: z.string().min(1)
});

export const ManageResponseSchema = z.object({
    items: z.array(RemoteBmpSchema),
    revision: z.int().nonnegative(),
    fileCount: z.int().nonnegative().optional(),
    failed: z.array(FolderFailureSchema).optional()
});

export type FileManageRequest = z.infer<typeof FileManageRequestSchema>;
export type FolderManageRequest = z.infer<typeof FolderManageRequestSchema>;
export type FolderFailure = z.infer<typeof FolderFailureSchema>;
export type ManageResponse = z.infer<typeof ManageResponseSchema>;
