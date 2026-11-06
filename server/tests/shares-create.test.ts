import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import type { CreateShareRequest } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { share, shareChunk, shareFile, user } from '../src/db/schema';
import { createShare, listShares, revokeShare } from '../src/shares';
import {
    connectedAccount,
    createUser,
    fileRequest,
    folderRequest,
    MUST_NOT_RESCAN,
    rejected,
    shareDatabase,
    singleSource,
    snapshotFile,
    snapshotOf
} from './helpers/shares';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';

describe.skipIf(!databaseUrl)('share creation', () => {
    const state = shareDatabase(databaseUrl);

    test('owner lists hide revoked shares while retaining their durable records', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'active-list');
        const { email } = await connectedAccount(context, userId, 'active-list');
        const firstId = '1'.repeat(64);
        const secondId = '2'.repeat(64);
        const active = await createShare(
            context,
            userId,
            fileRequest(email, firstId),
            singleSource(email, firstId)
        );
        const revoked = await createShare(
            context,
            userId,
            fileRequest(email, secondId),
            singleSource(email, secondId)
        );

        await revokeShare(context, userId, revoked.unwrap().id);

        const listed = await listShares(db, userId);
        expect(listed.unwrap()).toEqual([active.unwrap()]);
        const [stored] = await db.select().from(share).where(eq(share.id, revoked.unwrap().id));
        expect(stored?.status).toBe('revoked');
        expect(stored?.revokedAt).not.toBeNull();
    });

    test('an oversized resolved snapshot creates no share rows', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'bounded');
        const { email } = await connectedAccount(context, userId, 'bounded');
        const fileId = '1'.repeat(64);
        const created = await createShare(
            context,
            userId,
            fileRequest(email, fileId),
            singleSource(email, fileId, '', '', 2049)
        );
        expect(created.unwrapErr()).toBe(SERVER_ERRORS.SHARE_LIMIT_EXCEEDED);
        expect(await db.select().from(share)).toHaveLength(0);
        expect(await db.select().from(shareFile)).toHaveLength(0);
        expect(await db.select().from(shareChunk)).toHaveLength(0);
    });

    test('a file share is active at once, persists and reuses its request key', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'file');
        const { email } = await connectedAccount(context, userId, 'file');
        const request = fileRequest(email, '1'.repeat(64));

        const first = await createShare(
            context,
            userId,
            request,
            singleSource(email, '1'.repeat(64), 'Projects/2026')
        );
        const second = await createShare(context, userId, request, MUST_NOT_RESCAN);

        expect(first.unwrap()).toMatchObject({ kind: 'file', status: 'active', fileCount: 1 });
        expect(second.unwrap()).toEqual(first.unwrap());
        expect(first.unwrap().publicPath).toMatch(/^\/s\//);

        const listed = await listShares(context.db, userId);
        expect(listed.unwrap()).toEqual([first.unwrap()]);

        const [file] = await db
            .select()
            .from(shareFile)
            .where(eq(shareFile.shareId, first.unwrap().id));
        expect(file).toMatchObject({ folder: 'Projects/2026', relativeFolder: '' });
    });

    test('reusing a request key for different input fails without rescanning', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'fingerprint');
        const { email } = await connectedAccount(context, userId, 'fingerprint');
        const request = fileRequest(email, 'e'.repeat(64));

        await createShare(context, userId, request, singleSource(email, 'e'.repeat(64)));
        const changed = await createShare(
            context,
            userId,
            { ...request, name: 'Other' },
            MUST_NOT_RESCAN
        );

        expect(changed.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_INVALID);
    });

    test('a revoked share stays revoked when its request key is retried', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'retry');
        const { email } = await connectedAccount(context, userId, 'retry');
        const request = fileRequest(email, 'f'.repeat(64));
        const created = await createShare(
            context,
            userId,
            request,
            singleSource(email, 'f'.repeat(64))
        );

        await revokeShare(context, userId, created.unwrap().id);

        const retried = await createShare(context, userId, request, MUST_NOT_RESCAN);
        expect(retried.unwrap().status).toBe('revoked');
    });

    test('a concurrent create with the same key stores one share', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'race');
        const { email } = await connectedAccount(context, userId, 'race');
        const request = fileRequest(email, '7'.repeat(64));
        const options = singleSource(email, '7'.repeat(64));

        const [first, second] = await Promise.all([
            createShare(context, userId, request, options),
            createShare(context, userId, request, options)
        ]);

        expect(first.unwrap().id).toBe(second.unwrap().id);
        expect(await db.select().from(share)).toHaveLength(1);
        expect(await db.select().from(shareFile)).toHaveLength(1);
    });

    test('a file share in an account context must name that account', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'context');
        const first = await connectedAccount(context, userId, 'context-a');
        const second = await connectedAccount(context, userId, 'context-b');
        const request: CreateShareRequest = {
            ...fileRequest(first.id, '8'.repeat(64)),
            context: { kind: 'account', id: second.id }
        };

        const created = await createShare(context, userId, request, MUST_NOT_RESCAN);

        expect(created.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_INVALID);
        expect(await db.select().from(share)).toHaveLength(0);
    });

    test('a folder share keeps relative paths, chunks and payload sizes', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'folder');
        const { email } = await connectedAccount(context, userId, 'folder');
        const request: CreateShareRequest = {
            ...folderRequest(email),
            context: { kind: 'account', id: email }
        };

        const created = await createShare(
            context,
            userId,
            request,
            snapshotOf([
                {
                    accountEmail: email,
                    files: [
                        {
                            snapshot: snapshotFile(email, '2'.repeat(64), 'Projects/2026'),
                            relativeFolder: ''
                        },
                        {
                            snapshot: snapshotFile(email, '3'.repeat(64), 'Projects/2026/src', 3),
                            relativeFolder: 'src'
                        }
                    ]
                }
            ])
        );

        const id = created.unwrap().id;
        expect(created.unwrap().fileCount).toBe(2);

        const files = await db.select().from(shareFile).where(eq(shareFile.shareId, id));
        expect(files.map((file) => file.relativeFolder).sort()).toEqual(['', 'src']);

        const chunks = await db.select().from(shareChunk).where(eq(shareChunk.shareId, id));
        expect(chunks).toHaveLength(4);
        expect(chunks.every((chunk) => chunk.payloadSize === 10)).toBe(true);
    });

    test('a group folder is one share with one source per email', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'group');
        const first = await connectedAccount(context, userId, 'group-a');
        const second = await connectedAccount(context, userId, 'group-b');
        const fileId = '4'.repeat(64);

        const created = await createShare(
            context,
            userId,
            folderRequest('group-id'),
            snapshotOf(
                [first.email, second.email].map((accountEmail) => ({
                    accountEmail,
                    files: [
                        {
                            snapshot: snapshotFile(accountEmail, fileId, 'Projects/2026'),
                            relativeFolder: ''
                        }
                    ]
                }))
            )
        );

        expect(created.unwrap().fileCount).toBe(2);
        const files = await db
            .select()
            .from(shareFile)
            .where(eq(shareFile.shareId, created.unwrap().id));
        expect(files.map((file) => file.googleAccountEmail).sort()).toEqual([
            first.email,
            second.email
        ]);
    });

    test('a failed snapshot leaves no share and frees the request key', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'failed');
        const { email } = await connectedAccount(context, userId, 'failed');
        const request = fileRequest(email, '9'.repeat(64));

        const failed = await createShare(context, userId, request, {
            resolveSnapshot: () => rejected(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE)
        });

        expect(failed.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);
        expect(await db.select().from(share)).toHaveLength(0);

        const retried = await createShare(
            context,
            userId,
            request,
            singleSource(email, '9'.repeat(64))
        );
        expect(retried.unwrap().status).toBe('active');
    });

    test('a failing insert rolls the whole snapshot back', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'rollback');
        const { email } = await connectedAccount(context, userId, 'rollback');
        const fileId = '5'.repeat(64);
        const snapshot = snapshotFile(email, fileId, '');

        const failed = await createShare(
            context,
            userId,
            fileRequest(email, fileId),
            snapshotOf([
                {
                    accountEmail: email,
                    files: [
                        { snapshot, relativeFolder: '' },
                        { snapshot, relativeFolder: '' }
                    ]
                }
            ])
        );

        expect(failed.unwrapErr().code).toBe('DATABASE_UNAVAILABLE');
        expect(await db.select().from(share)).toHaveLength(0);
        expect(await db.select().from(shareFile)).toHaveLength(0);
    });

    test('a 5 GB file stores 26 chunks and the exact bigint size', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'large');
        const { email } = await connectedAccount(context, userId, 'large');
        const fileId = '6'.repeat(64);
        const snapshot = snapshotFile(email, fileId, '', 26, 195_000_000);
        const lastChunk = snapshot.file.chunks.at(-1)!;
        lastChunk.size = 125_000_000;
        snapshot.size = 5_000_000_000;

        const created = await createShare(
            context,
            userId,
            fileRequest(email, fileId),
            snapshotOf([{ accountEmail: email, files: [{ snapshot, relativeFolder: '' }] }])
        );

        const [file] = await db
            .select()
            .from(shareFile)
            .where(eq(shareFile.shareId, created.unwrap().id));
        expect(file).toMatchObject({ size: 5_000_000_000, chunkCount: 26 });
        expect(await db.select().from(shareChunk)).toHaveLength(26);
    });

    test('shares are isolated between users', async () => {
        const { db, context } = state;
        const owner = await createUser(db, 'one');
        const { email } = await connectedAccount(context, owner, 'one');
        const other = await createUser(db, 'two');
        const created = await createShare(
            context,
            owner,
            fileRequest(email, 'c'.repeat(64)),
            singleSource(email, 'c'.repeat(64))
        );

        expect((await listShares(context.db, other)).unwrap()).toEqual([]);
        expect((await revokeShare(context, other, created.unwrap().id)).unwrapErr()).toEqual(
            SERVER_ERRORS.SHARE_NOT_FOUND
        );
    });

    test('deleting the user cascades through every share table', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'cascade');
        const { email } = await connectedAccount(context, userId, 'cascade');
        await createShare(
            context,
            userId,
            fileRequest(email, 'd'.repeat(64)),
            singleSource(email, 'd'.repeat(64))
        );

        await db.delete(user).where(eq(user.id, userId));

        expect(await db.select().from(share)).toHaveLength(0);

        expect(await db.select().from(shareFile)).toHaveLength(0);
        expect(await db.select().from(shareChunk)).toHaveLength(0);
    });
});
