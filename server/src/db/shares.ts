import type { ShareKind, ShareStatus } from '@madkarmaa/phodrive-core/models';
import { sql } from 'drizzle-orm';
import {
    bigint,
    check,
    pgTable,
    text,
    timestamp,
    integer,
    boolean,
    unique,
    index,
    foreignKey,
    primaryKey,
    type AnyPgColumn
} from 'drizzle-orm/pg-core';

type RefTable = { id: AnyPgColumn };

export function createShareTables(user: RefTable) {
    const share = pgTable(
        'share',
        {
            id: text('id')
                .primaryKey()
                .$defaultFn(() => crypto.randomUUID()),
            userId: text('user_id')
                .notNull()
                .references(() => user.id, { onDelete: 'cascade' }),
            requestKey: text('request_key').notNull(),
            requestFingerprint: text('request_fingerprint').notNull(),
            kind: text('kind').$type<ShareKind>().notNull(),
            name: text('name').notNull(),
            status: text('status').$type<ShareStatus>().notNull(),
            publicToken: text('public_token').notNull(),
            createdAt: timestamp('created_at').defaultNow().notNull(),
            revokedAt: timestamp('revoked_at')
        },
        (table) => [
            unique('share_user_id_id_unique').on(table.userId, table.id),
            unique('share_user_request_key_unique').on(table.userId, table.requestKey),
            unique('share_public_token_unique').on(table.publicToken),
            index('share_user_created_idx').on(table.userId, table.createdAt),
            check('share_status_check', sql`${table.status} in ('active', 'revoked')`)
        ]
    );

    // No foreign key to google_account: disconnecting must preserve shares.
    const shareFile = pgTable(
        'share_file',
        {
            id: text('id')
                .notNull()
                .$defaultFn(() => crypto.randomUUID()),
            shareId: text('share_id').notNull(),
            userId: text('user_id').notNull(),
            googleAccountEmail: text('google_account_email').notNull(),
            fileId: text('file_id').notNull(),
            fileHash: text('file_hash').notNull(),
            name: text('name').notNull(),
            folder: text('folder').notNull(),
            relativeFolder: text('relative_folder').notNull(),
            chunkCount: integer('chunk_count').notNull(),
            size: bigint('size', { mode: 'number' }).notNull()
        },
        (table) => [
            primaryKey({
                name: 'share_file_pk',
                columns: [table.shareId, table.userId, table.googleAccountEmail, table.fileId]
            }),
            unique('share_file_id_unique').on(table.id),
            foreignKey({
                name: 'share_file_share_fk',
                columns: [table.shareId, table.userId],
                foreignColumns: [share.id, share.userId]
            }).onDelete('cascade')
        ]
    );

    const shareChunk = pgTable(
        'share_chunk',
        {
            shareId: text('share_id').notNull(),
            userId: text('user_id').notNull(),
            googleAccountEmail: text('google_account_email').notNull(),
            fileId: text('file_id').notNull(),
            chunkIndex: integer('chunk_index').notNull(),
            mediaKey: text('media_key').notNull(),
            sha1: text('sha1').notNull(),
            payloadSize: integer('payload_size').notNull(),
            isLast: boolean('is_last').notNull()
        },
        (table) => [
            primaryKey({
                name: 'share_chunk_pk',
                columns: [
                    table.shareId,
                    table.userId,
                    table.googleAccountEmail,
                    table.fileId,
                    table.chunkIndex
                ]
            }),
            foreignKey({
                name: 'share_chunk_file_fk',
                columns: [table.shareId, table.userId, table.googleAccountEmail, table.fileId],
                foreignColumns: [
                    shareFile.shareId,
                    shareFile.userId,
                    shareFile.googleAccountEmail,
                    shareFile.fileId
                ]
            }).onDelete('cascade')
        ]
    );

    return { share, shareFile, shareChunk };
}
