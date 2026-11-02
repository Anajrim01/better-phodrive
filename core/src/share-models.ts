import { z } from 'zod';
import { AlbumKeySchema, EmailSchema, FileNameSchema, Sha256HexSchema } from './models';

export const SHARE_MANIFEST_VERSION = 1;
export const SHARE_BASE_URL = 'https://shared.phodrive.dev/#share=';
export const MAX_SHARE_NAME_LENGTH = 200;
export const MAX_SHARE_FILES = 100;
export const MAX_SHARE_CHUNKS = 500;
export const MAX_SHARE_URL_LENGTH = 8000;
export const SHARE_SHORT_URL_PATTERN = /^https:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9_-]+$/;
export const SHARE_ALBUM_PATH_PATTERN = /^\/share\/[A-Za-z0-9_-]+$/;

export const ShareShortUrlSchema = z.string().max(2048).regex(SHARE_SHORT_URL_PATTERN);
const ShareAuthKeySchema = z
    .string()
    .max(4096)
    .refine((key) => key.length === 0 || !/[\s\0]/.test(key));

export const ShareCanonicalUrlSchema = z.string().max(4096).refine(isCanonicalShareAlbumUrl);

export function isCanonicalShareAlbumUrl(value: string): boolean {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        return false;
    }

    return (
        url.protocol === 'https:' &&
        url.hostname === 'photos.google.com' &&
        SHARE_ALBUM_PATH_PATTERN.test(url.pathname) &&
        url.searchParams.size === 1 &&
        /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('key') ?? '')
    );
}

export const ShareChunkRefSchema = z
    .object({
        index: z.int().nonnegative(),
        mediaKey: z.string().min(1).max(2048)
    })
    .strict();

export const ShareFileInputSchema = z
    .object({
        id: Sha256HexSchema,
        name: FileNameSchema.optional(),
        chunks: z.array(ShareChunkRefSchema).min(1).max(MAX_SHARE_CHUNKS)
    })
    .strict()
    .superRefine((file, context) => {
        const indices = file.chunks.map((chunk) => chunk.index).toSorted((a, b) => a - b);
        const unique = new Set(indices);
        if (unique.size !== indices.length) {
            context.addIssue({ code: 'custom', message: 'Chunk indices must be unique.' });

            return;
        }

        for (let index = 0; index < indices.length; index++) {
            if (indices[index] === index) continue;

            context.addIssue({ code: 'custom', message: 'Chunk indices must start at zero.' });

            return;
        }
    });

const ShareExistingSchema = z
    .object({
        envelopeKey: AlbumKeySchema,
        albumKey: AlbumKeySchema,
        shortUrl: ShareShortUrlSchema.optional(),
        albumUrl: ShareCanonicalUrlSchema,
        authKey: ShareAuthKeySchema,
        shareUrl: z.url().max(MAX_SHARE_URL_LENGTH).startsWith(SHARE_BASE_URL)
    })
    .strict();

export const ShareCreateRequestSchema = z
    .object({
        action: z.literal('create'),
        email: EmailSchema,
        token: z.string(),
        name: z.string().trim().min(1).max(MAX_SHARE_NAME_LENGTH),
        files: z.array(ShareFileInputSchema).min(1).max(MAX_SHARE_FILES).optional(),
        existing: ShareExistingSchema.optional()
    })
    .strict()
    .superRefine((request, context) => {
        if (request.existing !== undefined) {
            if (request.files !== undefined)
                context.addIssue({
                    code: 'custom',
                    message: 'An existing share cannot change its files.'
                });

            return;
        }

        if (request.files === undefined) {
            context.addIssue({ code: 'custom', message: 'Choose files to share.' });

            return;
        }

        const chunks = request.files.reduce((total, file) => total + file.chunks.length, 0);
        if (chunks > MAX_SHARE_CHUNKS)
            context.addIssue({ code: 'custom', message: 'Too many chunks for one share.' });

        const ids = new Set(request.files.map((file) => file.id));
        if (ids.size !== request.files.length)
            context.addIssue({ code: 'custom', message: 'Every share file must be unique.' });
    });

export const ShareRevokeRequestSchema = z
    .object({
        action: z.literal('revoke'),
        email: EmailSchema,
        token: z.string(),
        envelopeKey: AlbumKeySchema,
        albumKey: AlbumKeySchema,
        shortUrl: ShareShortUrlSchema,
        albumUrl: ShareCanonicalUrlSchema
    })
    .strict();

export const ShareRequestSchema = z.discriminatedUnion('action', [
    ShareCreateRequestSchema,
    ShareRevokeRequestSchema
]);

export const ShareManifestFileSchema = z
    .object({
        id: Sha256HexSchema,
        chunks: z.int().positive().max(MAX_SHARE_CHUNKS),
        name: FileNameSchema.optional()
    })
    .strict();

export const ShareManifestSchema = z
    .object({
        v: z.literal(SHARE_MANIFEST_VERSION),
        album: ShareCanonicalUrlSchema,
        files: z.array(ShareManifestFileSchema).min(1).max(MAX_SHARE_FILES)
    })
    .strict();

export const ShareRecordSchema = z
    .object({
        name: z.string().trim().min(1).max(MAX_SHARE_NAME_LENGTH),
        envelopeKey: AlbumKeySchema,
        albumKey: AlbumKeySchema,
        shortUrl: ShareShortUrlSchema,
        albumUrl: ShareCanonicalUrlSchema,
        authKey: ShareAuthKeySchema,
        shareUrl: z.url().max(MAX_SHARE_URL_LENGTH).startsWith(SHARE_BASE_URL),
        createdAt: z.int().nonnegative()
    })
    .strict();

export const StoredSharesSchema = z.record(
    EmailSchema,
    z.array(ShareRecordSchema).max(MAX_SHARE_FILES)
);

export const ShareCreateResponseSchema = z
    .object({
        record: ShareRecordSchema,
        manifest: ShareManifestSchema
    })
    .strict();

export const ShareRevokeResponseSchema = z
    .object({
        revoked: z.literal(true),
        shortUrlStatus: z.int().nullable(),
        albumUrlStatus: z.int().nullable(),
        directUrlStatus: z.int().nullable(),
        envelopeDeleted: z.boolean(),
        albumRemoved: z.boolean()
    })
    .strict();

export type ShareChunkRef = z.infer<typeof ShareChunkRefSchema>;
export type ShareFileInput = z.infer<typeof ShareFileInputSchema>;
export type ShareExisting = z.infer<typeof ShareExistingSchema>;
export type ShareCreateRequest = z.infer<typeof ShareCreateRequestSchema>;
export type ShareRevokeRequest = z.infer<typeof ShareRevokeRequestSchema>;
export type ShareRequest = z.infer<typeof ShareRequestSchema>;
export type ShareManifestFile = z.infer<typeof ShareManifestFileSchema>;
export type ShareManifest = z.infer<typeof ShareManifestSchema>;
export type ShareRecord = z.infer<typeof ShareRecordSchema>;
export type StoredShares = z.infer<typeof StoredSharesSchema>;
export type ShareCreateResponse = z.infer<typeof ShareCreateResponseSchema>;
export type ShareRevokeResponse = z.infer<typeof ShareRevokeResponseSchema>;
