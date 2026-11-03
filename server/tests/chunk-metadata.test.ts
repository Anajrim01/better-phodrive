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
        'google_email',
        'media_key'
    ]);
    expect(table.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
            'user_id',
            'google_email',
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
});

test('the migration creates the scoped metadata table', async () => {
    const migration = await readFile(
        new URL('../drizzle/0001_fuzzy_luminals.sql', import.meta.url),
        'utf8'
    );

    expect(migration).toContain('CREATE TABLE "chunk_metadata"');
    expect(migration).toContain('PRIMARY KEY("user_id","google_email","media_key")');
    expect(migration).toContain('REFERENCES "public"."user"("id") ON DELETE cascade');
});
