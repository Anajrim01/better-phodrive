import { relations } from 'drizzle-orm';
import {
    boolean,
    foreignKey,
    index,
    integer,
    pgTable,
    primaryKey,
    text,
    timestamp,
    unique
} from 'drizzle-orm/pg-core';
import { createShareTables } from './shares';

// Better Auth tables, generated with `auth generate` for the Drizzle PostgreSQL adapter.
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
        .defaultNow()
        .$onUpdate(() => new Date())
        .notNull()
});

export const session = pgTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: timestamp('expires_at').notNull(),
        token: text('token').notNull().unique(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at')
            .$onUpdate(() => new Date())
            .notNull(),
        ipAddress: text('ip_address'),
        userAgent: text('user_agent'),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' })
    },
    (table) => [index('session_userId_idx').on(table.userId)]
);

export const account = pgTable(
    'account',
    {
        id: text('id').primaryKey(),
        accountId: text('account_id').notNull(),
        providerId: text('provider_id').notNull(),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: timestamp('access_token_expires_at'),
        refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
        scope: text('scope'),
        password: text('password'),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at')
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [index('account_userId_idx').on(table.userId)]
);

export const verification = pgTable(
    'verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: timestamp('expires_at').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at')
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const userRelations = relations(user, ({ many }) => ({
    sessions: many(session),
    accounts: many(account)
}));

export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, { fields: [session.userId], references: [user.id] })
}));

export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, { fields: [account.userId], references: [user.id] })
}));

/** A user may connect several Google accounts; the AAS token is encrypted with the auth secret. */
export const googleAccount = pgTable(
    'google_account',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        email: text('email').notNull(),
        encryptedToken: text('encrypted_token').notNull(),
        createdAt: timestamp('created_at').defaultNow().notNull(),
        updatedAt: timestamp('updated_at')
            .defaultNow()
            .$onUpdate(() => new Date())
            .notNull()
    },
    (table) => [
        unique('google_account_user_id_id_unique').on(table.userId, table.id),
        unique('google_account_user_id_email_unique').on(table.userId, table.email)
    ]
);

/** Named groups are owned by one user and contain that user's Google accounts. */
export const googleAccountGroup = pgTable(
    'google_account_group',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: text('user_id')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        name: text('name').notNull()
    },
    (table) => [unique('google_account_group_user_id_id_unique').on(table.userId, table.id)]
);

/** Composite foreign keys keep a group and its accounts under the same user. */
export const googleAccountGroupMember = pgTable(
    'google_account_group_member',
    {
        userId: text('user_id').notNull(),
        groupId: text('group_id').notNull(),
        googleAccountId: text('google_account_id').notNull()
    },
    (table) => [
        primaryKey({
            name: 'google_account_group_member_pk',
            columns: [table.userId, table.groupId, table.googleAccountId]
        }),
        foreignKey({
            name: 'google_account_group_member_group_fk',
            columns: [table.userId, table.groupId],
            foreignColumns: [googleAccountGroup.userId, googleAccountGroup.id]
        }).onDelete('cascade'),
        foreignKey({
            name: 'google_account_group_member_account_fk',
            columns: [table.userId, table.googleAccountId],
            foreignColumns: [googleAccount.userId, googleAccount.id]
        }).onDelete('cascade'),
        index('google_account_group_member_account_idx').on(table.userId, table.googleAccountId)
    ]
);

const shareTables = createShareTables(user);
export const share = shareTables.share;
export const shareFile = shareTables.shareFile;
export const shareChunk = shareTables.shareChunk;

/**
 * Resolved BMP metadata for one Google media item.
 * Google remains authoritative for existence and stored bytes; this table only avoids re-probing
 * rows whose current listing fingerprint and stored size still match.
 */
export const chunkMetadata = pgTable(
    'chunk_metadata',
    {
        userId: text('user_id').notNull(),
        googleAccountId: text('google_account_id').notNull(),
        mediaKey: text('media_key').notNull(),
        sha1: text('sha1').notNull(),
        storedBmpSize: integer('stored_bmp_size').notNull(),
        fileHash: text('file_hash').notNull(),
        fileId: text('file_id').notNull(),
        chunkIndex: integer('chunk_index').notNull(),
        isLast: boolean('is_last').notNull(),
        originalName: text('original_name'),
        folder: text('folder'),
        size: integer('size').notNull()
    },
    (table) => [
        primaryKey({
            name: 'chunk_metadata_scope_pk',
            columns: [table.userId, table.googleAccountId, table.mediaKey]
        }),
        foreignKey({
            name: 'chunk_metadata_account_fk',
            columns: [table.userId, table.googleAccountId],
            foreignColumns: [googleAccount.userId, googleAccount.id]
        }).onDelete('cascade')
    ]
);
