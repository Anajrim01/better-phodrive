import { z } from 'zod';

export enum UploadJobStatus {
    Queued = 'queued',
    Active = 'active',
    Complete = 'complete',
    Error = 'error'
}

export enum UploadPhase {
    Receiving = 'receiving',
    Preparing = 'preparing',
    Uploading = 'uploading'
}

export enum UploadStatus {
    Uploaded = 'uploaded',
    AlreadyExists = 'already exists'
}

export enum UploadEventType {
    Queued = 'queued',
    Progress = 'progress',
    Chunk = 'chunk',
    FileComplete = 'file-complete',
    FileError = 'file-error',
    Complete = 'complete',
    Error = 'error'
}

export enum FileActionKind {
    Download = 'download',
    Delete = 'delete'
}

export enum AppView {
    Files = 'files',
    Settings = 'settings'
}

export enum ConfirmKind {
    Account = 'account',
    File = 'file'
}

export enum ThemeMode {
    Light = 'light',
    Dark = 'dark',
    Auto = 'auto'
}

export enum FileSort {
    NameAscending = 'name-asc',
    NameDescending = 'name-desc',
    ModifiedDescending = 'modified-desc',
    ModifiedAscending = 'modified-asc'
}

export enum FileLayout {
    List = 'list',
    Grid = 'grid'
}

export const DEFAULT_FILE_LAYOUT = FileLayout.List;
export const FileLayoutSchema = z.enum(FileLayout);

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;
export const MAX_REFRESH_INTERVAL_SECONDS = 86_400;
export const DEFAULT_CONCURRENT_WORKERS = 8;
export const MAX_CONCURRENT_WORKERS = 32;

export const ThemeSchema = z.enum(ThemeMode);
export const FileSortSchema = z.enum(FileSort);
export const RefreshIntervalSchema = z.int().min(0).max(MAX_REFRESH_INTERVAL_SECONDS);
export const ConcurrentWorkersSchema = z.int().min(1).max(MAX_CONCURRENT_WORKERS);
/** Servers limit requested workers to their own processors, so any positive count is accepted. */
export const WorkerCountSchema = z.int().positive();
export const PreferencesDefaultsSchema = z.object({
    theme: ThemeSchema,
    fileSort: FileSortSchema,
    refreshIntervalSeconds: RefreshIntervalSchema,
    concurrentWorkers: ConcurrentWorkersSchema
});
export const EmailSchema = z.email();
export const AasTokenSchema = z.string().startsWith('aas_et/');
export const SelectedAccountSchema = z.union([EmailSchema, z.literal('')]);

export const AccountSchema = z.object({
    email: EmailSchema,
    token: AasTokenSchema
});

export const NewAccountSchema = z.object({
    email: z.email({ error: 'Enter a valid Google account email.' }),
    token: z
        .string()
        .refine((value) => value.startsWith('oauth2_') || value.startsWith('aas_et/'), {
            error: 'Enter an OAuth2 token starting with oauth2_ or an AAS token starting with aas_et/.'
        })
});

export const StoredAccountsSchema = z.record(z.string(), z.unknown());
/** Names become path segments and multipart filenames, so separators and controls are unsafe. */
export const FileNameSchema = z
    .string()
    .min(1)
    .refine((name) => !/[\\/\r\n\0]/.test(name));
export const MAX_FOLDER_PATH_LENGTH = 512;
export const MAX_FOLDER_SEGMENT_LENGTH = 255;
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
export const AlbumKeySchema = z
    .string()
    .min(1)
    .max(512)
    .refine((key) => !/[\s\0]/.test(key));
export type StoredAlbums = Record<string, Record<string, string>>;

export function parseStoredAlbums(value: unknown): StoredAlbums {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const albums: StoredAlbums = {};
    for (const [email, folders] of Object.entries(value)) {
        if (!EmailSchema.safeParse(email).success) continue;
        if (!folders || typeof folders !== 'object' || Array.isArray(folders)) continue;

        const valid: Record<string, string> = {};
        for (const [folder, key] of Object.entries(folders)) {
            const parsedFolder = FolderPathSchema.safeParse(folder);
            const parsedKey = AlbumKeySchema.safeParse(key);
            if (parsedFolder.success && parsedKey.success)
                valid[parsedFolder.data] = parsedKey.data;
        }
        if (Object.keys(valid).length) albums[email] = valid;
    }

    return albums;
}

export const StoredAlbumsSchema = z.unknown().transform(parseStoredAlbums);
export const FileSizeSchema = z.int().nonnegative();
export const Sha1HexSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** The split header flags byte is a bitfield; version 1 only ever wrote bit 0. */
export const SPLIT_FLAG_LAST = 1;
export const SPLIT_FLAG_COMPRESSED = 2;
export const SPLIT_FLAGS_MAX = SPLIT_FLAG_LAST | SPLIT_FLAG_COMPRESSED;

export function splitHeaderIsLast(flags: number): boolean {
    return (flags & SPLIT_FLAG_LAST) !== 0;
}

export function splitHeaderIsCompressed(flags: number): boolean {
    return (flags & SPLIT_FLAG_COMPRESSED) !== 0;
}

export const SplitHeaderSchema = z
    .object({
        fileHash: Sha256HexSchema,
        fileId: Sha256HexSchema,
        chunkIndex: z.int().nonnegative(),
        flags: z.int().min(0).max(SPLIT_FLAGS_MAX),
        payloadSize: z.int().nonnegative(),
        originalSize: z.int().nonnegative().optional(),
        fileName: z.string().min(1).optional(),
        folder: FolderPathSchema.optional()
    })
    .refine((header) => header.chunkIndex !== 0 || header.fileName !== undefined)
    .refine((header) => header.chunkIndex === 0 || header.folder === undefined)
    .refine(
        (header) => splitHeaderIsCompressed(header.flags) === (header.originalSize !== undefined)
    )
    .refine(
        (header) =>
            !splitHeaderIsCompressed(header.flags) || header.originalSize! >= header.payloadSize
    );

export const RemoteBmpSchema = z.object({
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunkIndex: z.int().nonnegative(),
    isLast: z.boolean(),
    originalName: z.string().min(1).optional(),
    folder: FolderPathSchema.optional(),
    size: z.number().nonnegative(),
    storedSize: z.int().nonnegative().optional(),
    compressed: z.boolean().optional(),
    at: z.int().nonnegative(),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

export const LibraryResponseSchema = z.object({
    items: z.array(RemoteBmpSchema),
    nextPageToken: z.string()
});

export const UploadResponseSchema = z.object({
    status: z.enum(UploadStatus),
    mediaKey: z.string().min(1),
    sha1: Sha1HexSchema
});

export const DeleteResponseSchema = z.object({ deleted: z.literal(true) });
export const ErrorResponseSchema = z.object({
    error: z.string(),
    retryAfterSeconds: z.int().nonnegative().optional()
});
export const UploadProgressSchema = z
    .discriminatedUnion('phase', [
        z.object({
            phase: z.enum([UploadPhase.Receiving, UploadPhase.Preparing]),
            completed: z.int().nonnegative(),
            total: z.int().nonnegative()
        }),
        z.object({
            phase: z.literal(UploadPhase.Uploading),
            completed: z.int().nonnegative(),
            total: z.int().positive(),
            reused: z.int().nonnegative(),
            retryAfterSeconds: z.int().positive().optional()
        })
    ])
    .refine(
        (progress) =>
            progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0) <=
            progress.total
    );
export const UploadEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal(UploadEventType.Queued), id: z.int().nonnegative() }),
    z.object({
        type: z.literal(UploadEventType.Progress),
        id: z.int().nonnegative(),
        progress: UploadProgressSchema
    }),
    z.object({
        type: z.literal(UploadEventType.Chunk),
        id: z.int().nonnegative(),
        chunk: RemoteBmpSchema
    }),
    z.object({
        type: z.literal(UploadEventType.FileComplete),
        id: z.int().nonnegative(),
        result: UploadResponseSchema
    }),
    z.object({
        type: z.literal(UploadEventType.FileError),
        id: z.int().nonnegative(),
        error: z.string()
    }),
    z.object({ type: z.literal(UploadEventType.Complete) }),
    z.object({
        type: z.literal(UploadEventType.Error),
        error: z.string(),
        retryAfterSeconds: z.int().positive().optional()
    })
]);
export const AccountConnectionSchema = z.union([
    z.object({ token: AasTokenSchema }),
    ErrorResponseSchema
]);
export const AccountRequestSchema = z.object({ email: EmailSchema, token: z.string() });
export const LibraryRequestSchema = AccountRequestSchema.extend({
    pageToken: z.string().optional()
});
export const FileRequestSchema = AccountRequestSchema.extend({
    action: z.enum(FileActionKind),
    name: z.string().min(1),
    fileHash: Sha256HexSchema,
    fileId: Sha256HexSchema,
    chunks: z.array(RemoteBmpSchema).nonempty(),
    workers: WorkerCountSchema
});
export const FileDeleteResponseSchema = z.object({
    deleted: z.array(RemoteBmpSchema),
    error: z.string().optional(),
    retryAfterSeconds: z.int().positive().optional()
});
export const UploadFileSchema = z.object({
    name: FileNameSchema,
    folder: FolderPathSchema.optional(),
    size: FileSizeSchema,
    fileHash: Sha256HexSchema
});
export const UploadRequestSchema = AccountSchema.extend({
    file: UploadFileSchema,
    chunkIndex: z.int().nonnegative(),
    sha1: Sha1HexSchema
});
export const MAX_ALBUM_BATCH_SIZE = 500;
export const AlbumAssignRequestSchema = AccountRequestSchema.extend({
    folder: FolderPathSchema,
    albumKey: AlbumKeySchema.optional(),
    mediaKeys: z.array(z.string().min(1).max(2048)).min(1).max(MAX_ALBUM_BATCH_SIZE)
});
export const AlbumAssignResponseSchema = z.object({ albumKey: AlbumKeySchema });
export type UploadFile = z.infer<typeof UploadFileSchema>;
export type ChunkUploadRequest = z.infer<typeof UploadRequestSchema>;
export type AlbumAssignRequest = z.infer<typeof AlbumAssignRequestSchema>;
export type AlbumAssignResponse = z.infer<typeof AlbumAssignResponseSchema>;

export type RemoteBmp = z.infer<typeof RemoteBmpSchema>;
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
export type SplitHeader = z.infer<typeof SplitHeaderSchema>;
export type UploadResponse = z.infer<typeof UploadResponseSchema>;
export type UploadEvent = z.infer<typeof UploadEventSchema>;
export type UploadProgress = z.infer<typeof UploadProgressSchema>;
export type FileRequest = z.infer<typeof FileRequestSchema>;
export type RefreshInterval = z.infer<typeof RefreshIntervalSchema>;
export type ConcurrentWorkers = z.infer<typeof ConcurrentWorkersSchema>;
export type PreferencesDefaults = z.infer<typeof PreferencesDefaultsSchema>;
export type AccountConnection = z.infer<typeof AccountConnectionSchema>;

export const DEFAULT_FILE_SORT = FileSort.ModifiedDescending;
export const DEFAULT_PREFERENCES_DEFAULTS: PreferencesDefaults = {
    theme: ThemeMode.Auto,
    fileSort: DEFAULT_FILE_SORT,
    refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
    concurrentWorkers: DEFAULT_CONCURRENT_WORKERS
};
