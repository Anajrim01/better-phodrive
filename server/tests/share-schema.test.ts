import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { expect, test } from 'vitest';
import { share, shareChunk, shareFile } from '../src/db/schema';

function columnNames(table: Parameters<typeof getTableConfig>[0]) {
    return getTableConfig(table).columns.map((column) => column.name);
}

test('share tables hold only the snapshot, with no provider state', () => {
    expect(columnNames(share)).toEqual([
        'id',
        'user_id',
        'request_key',
        'request_fingerprint',
        'kind',
        'name',
        'status',
        'public_token',
        'created_at',
        'revoked_at'
    ]);
    expect(columnNames(shareFile)).toEqual([
        'id',
        'share_id',
        'user_id',
        'google_account_email',
        'file_id',
        'file_hash',
        'name',
        'folder',
        'relative_folder',
        'chunk_count',
        'size'
    ]);
    expect(columnNames(shareChunk)).toEqual([
        'share_id',
        'user_id',
        'google_account_email',
        'file_id',
        'chunk_index',
        'media_key',
        'sha1',
        'payload_size',
        'is_last'
    ]);
    expect(
        getTableConfig(share).uniqueConstraints.map((unique) =>
            unique.columns.map((column) => column.name)
        )
    ).toEqual(expect.arrayContaining([['user_id', 'request_key'], ['public_token']]));
});

test('the share migration creates only the snapshot tables and their cascades', async () => {
    const migration = await readFile(
        new URL('../drizzle/0002_public_shares.sql', import.meta.url),
        'utf8'
    );

    expect(
        [...migration.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]).sort()
    ).toEqual(['share', 'share_chunk', 'share_file']);
    expect(migration).toContain(`CHECK ("share"."status" in ('active', 'revoked'))`);
    expect(migration).toContain(
        'FOREIGN KEY ("share_id","user_id") REFERENCES "public"."share"("id","user_id") ON DELETE cascade'
    );
    expect(migration).toContain(
        'FOREIGN KEY ("share_id","user_id","google_account_email","file_id") REFERENCES "public"."share_file"'
    );
    expect(migration).not.toContain('share_source');
    expect(migration).toContain('ON DELETE cascade');
    expect(migration).not.toContain('"public"."google_account"');
    expect(migration).toContain('"size" bigint NOT NULL');
});
