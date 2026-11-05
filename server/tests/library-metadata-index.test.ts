import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import { scanLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { bytesField, message, nested } from '@madkarmaa/phodrive-core/server/protobuf';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { createChunkMetadataStore } from '../src/chunk-metadata';
import { createDatabase, type Database } from '../src/db/client';
import { migrateDatabase } from '../src/db/migrate';
import { chunkMetadata, user } from '../src/db/schema';
import { saveGoogleAccount } from '../src/google';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const describeDatabase = describe.skipIf(!databaseUrl);
const HEADERS = { commonHeaders: {}, rpcHeaders: {} } as unknown as Parameters<
    typeof scanLibraryPage
>[1];

type Counts = { prepare: number; media: number };

function makeBmp(payload: Uint8Array): Buffer {
    const prefix = encodeSplitPrefix({
        fileHash: 'a'.repeat(64),
        fileId: 'b'.repeat(64),
        chunkIndex: 0,
        flags: 1,
        payloadSize: payload.length,
        fileName: 'note.bin'
    }).unwrap();
    const bmp = Buffer.alloc(prefix.totalSize);
    bmp.set(prefix.prefix);
    bmp.set(payload, prefix.prefix.length);

    return bmp;
}

function candidate(mediaKey: string, bmp: Buffer, at = 1) {
    return {
        mediaKey,
        sha1: createHash('sha1').update(bmp).digest('hex'),
        size: bmp.length,
        at
    };
}

function fetcherFor(bmps: ReadonlyMap<string, Buffer>, counts: Counts): Fetcher {
    const byKey = new Map(
        [...bmps].map(([mediaKey, bmp]) => [
            mediaKey,
            { bmp, sha1: createHash('sha1').update(bmp).digest('hex') }
        ])
    );

    return async (input, init) => {
        const url = String(input);
        if (url.includes('PhotosPrepareDownload')) {
            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const mediaKey = nested(request, 1, 1, 1).unwrap().toString();
            const item = byKey.get(mediaKey);
            if (!item) throw new Error(`Missing prepare item ${mediaKey}`);
            counts.prepare++;

            return new Response(
                Uint8Array.from(
                    message(
                        bytesField(
                            1,
                            message(
                                bytesField(1, mediaKey),
                                bytesField(
                                    2,
                                    bytesField(13, bytesField(1, Buffer.from(item.sha1, 'hex')))
                                ),
                                bytesField(
                                    5,
                                    bytesField(
                                        2,
                                        bytesField(
                                            5,
                                            `https://lh3.googleusercontent.com/p/${mediaKey}=d`
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            );
        }

        const mediaKey = url.split('/').pop()?.replace('=d', '') ?? '';
        const item = byKey.get(mediaKey);
        if (!item) throw new Error(`Missing media item ${mediaKey}`);
        counts.media++;

        return new Response(Uint8Array.from(item.bmp), { status: 206 });
    };
}

describeDatabase('chunk metadata index', () => {
    let db: Database;
    let context: { db: Database; env: { BETTER_AUTH_SECRET: string } };

    beforeAll(async () => {
        const migrated = await migrateDatabase(
            databaseUrl,
            fileURLToPath(new URL('../drizzle', import.meta.url))
        );
        expect(migrated.isOk()).toBe(true);
        db = createDatabase(databaseUrl);
        context = { db, env: { BETTER_AUTH_SECRET: 'x'.repeat(32) } };
    });

    beforeEach(async () => {
        await db.delete(user);
    });

    afterAll(async () => {
        await db.$client.end();
    });

    async function account(run: string) {
        const userId = `metadata-user-${run}`;
        await db.insert(user).values({
            id: userId,
            name: 'Metadata',
            email: `metadata-${run}@example.com`
        });
        const saved = (
            await saveGoogleAccount(context, userId, {
                email: `metadata-${run}@google.example`,
                token: 'aas_et/metadata'
            })
        ).unwrap();

        return { userId, accountId: saved.id };
    }

    test('a saved row is reused until the listing identity changes', async () => {
        const { userId, accountId } = await account(Date.now().toString(36));
        const store = createChunkMetadataStore(db, { userId, googleAccountId: accountId });
        const bmp = makeBmp(Uint8Array.of(1, 2, 3, 4));
        const first = candidate('media-a', bmp);
        const counts: Counts = { prepare: 0, media: 0 };

        const cold = await scanLibraryPage(
            { items: [first], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', bmp]]), counts),
            store
        );
        expect(cold.unwrap().items).toHaveLength(1);
        expect(counts).toEqual({ prepare: 1, media: 1 });

        const warm = await scanLibraryPage(
            { items: [first], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', bmp]]), counts),
            store
        );
        expect(warm.unwrap().items).toHaveLength(1);
        expect(counts).toEqual({ prepare: 1, media: 1 });

        const changedBmp = makeBmp(Uint8Array.of(5, 6, 7, 8));
        const changed = candidate('media-a', changedBmp);
        const refreshed = await scanLibraryPage(
            { items: [changed], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', changedBmp]]), counts),
            store
        );
        expect(refreshed.unwrap().items).toHaveLength(1);
        expect(counts).toEqual({ prepare: 2, media: 2 });

        const rows = await db
            .select()
            .from(chunkMetadata)
            .where(and(eq(chunkMetadata.userId, userId), eq(chunkMetadata.mediaKey, 'media-a')));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.sha1).toBe(changed.sha1);
        expect(rows[0]?.storedBmpSize).toBe(changedBmp.length);
    });

    test('an indexed copy answers an identical cold media key without a probe', async () => {
        const { userId, accountId } = await account(Date.now().toString(36));
        const store = createChunkMetadataStore(db, { userId, googleAccountId: accountId });
        const bmp = makeBmp(Uint8Array.of(1, 2, 3, 4));
        const first = candidate('media-a', bmp, 1);
        const copy = candidate('media-b', bmp, 2);
        const counts: Counts = { prepare: 0, media: 0 };

        await scanLibraryPage(
            { items: [first], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', bmp]]), counts),
            store
        );

        const result = await scanLibraryPage(
            { items: [first, copy], nextPageToken: '' },
            HEADERS,
            fetcherFor(
                new Map([
                    ['media-a', bmp],
                    ['media-b', bmp]
                ]),
                counts
            ),
            store
        );

        expect(result.unwrap().items).toHaveLength(2);
        expect(counts).toEqual({ prepare: 1, media: 1 });
        const rows = await db.select().from(chunkMetadata).where(eq(chunkMetadata.userId, userId));
        expect(rows.map((row) => row.mediaKey).sort()).toEqual(['media-a', 'media-b']);
    });

    test('a batch with duplicate media keys keeps the last row', async () => {
        const { userId, accountId } = await account(Date.now().toString(36));
        const store = createChunkMetadataStore(db, { userId, googleAccountId: accountId });
        const record = {
            mediaKey: 'duplicate-key',
            sha1: '1'.repeat(40),
            storedBmpSize: 3126,
            fileHash: 'a'.repeat(64),
            chunkIndex: 0,
            isLast: true,
            originalName: 'note.bin',
            size: 4
        };

        const saved = await store.save([
            { ...record, fileId: 'first' },
            { ...record, fileId: 'second' }
        ]);
        expect(saved.isOk()).toBe(true);

        const candidate = {
            mediaKey: record.mediaKey,
            sha1: record.sha1,
            size: record.storedBmpSize,
            at: 1
        };
        const row = (await store.load([candidate])).unwrap().get(record.mediaKey);
        expect(row?.fileId).toBe('second');
        expect((await store.save([])).isOk()).toBe(true);
    });

    test('a row from another Google account is never reused', async () => {
        const run = Date.now().toString(36);
        const first = await account(`one-${run}`);
        const second = await account(`two-${run}`);
        const bmp = makeBmp(Uint8Array.of(1, 2, 3, 4));
        const item = candidate('media-a', bmp);
        const counts: Counts = { prepare: 0, media: 0 };

        await scanLibraryPage(
            { items: [item], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', bmp]]), counts),
            createChunkMetadataStore(db, {
                userId: first.userId,
                googleAccountId: first.accountId
            })
        );

        const result = await scanLibraryPage(
            { items: [item], nextPageToken: '' },
            HEADERS,
            fetcherFor(new Map([['media-a', bmp]]), counts),
            createChunkMetadataStore(db, {
                userId: second.userId,
                googleAccountId: second.accountId
            })
        );

        expect(result.unwrap().items).toHaveLength(1);
        expect(counts).toEqual({ prepare: 2, media: 2 });
    });
});
