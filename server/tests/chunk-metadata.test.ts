import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, test } from 'vitest';
import { chunkMetadata } from '../src/db/schema';

test('chunk metadata is scoped by user, Google account, and media key', () => {
    const table = getTableConfig(chunkMetadata);

    expect(table.name).toBe('chunk_metadata');
    expect(table.primaryKeys).toHaveLength(1);
    expect(table.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
        'user_id',
        'google_account_id',
        'media_key'
    ]);
    expect(table.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
            'user_id',
            'google_account_id',
            'media_key',
            'sha1',
            'stored_bmp_size',
            'file_hash',
            'file_id',
            'chunk_index',
            'is_last',
            'original_name',
            'size'
        ])
    );
    expect(table.columns.map((column) => column.name)).not.toContain('google_email');
    expect(
        table.foreignKeys.map((key) => key.reference().columns.map((column) => column.name))
    ).toContainEqual(['user_id', 'google_account_id']);
});

test('the migration creates account groups and scopes metadata by account id', async () => {
    const migration = await readFile(
        new URL('../drizzle/0001_account_groups.sql', import.meta.url),
        'utf8'
    );

    expect(migration).toContain('ALTER TABLE "google_account" ADD COLUMN "id" text');
    expect(migration).toContain('CREATE TABLE "chunk_metadata"');
    expect(migration).toContain('PRIMARY KEY("user_id","google_account_id","media_key")');
    expect(migration).toContain(
        'FOREIGN KEY ("user_id","google_account_id") REFERENCES "public"."google_account"("user_id","id") ON DELETE cascade'
    );
    expect(migration).toContain('CREATE TABLE "google_account_group"');
    expect(migration).toContain('CREATE TABLE "google_account_group_member"');
});
