import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createChunkMetadataStore } from '../src/chunk-metadata';
import { createDatabase, type Database } from '../src/db/client';
import { migrateDatabase } from '../src/db/migrate';
import { chunkMetadata, user } from '../src/db/schema';
import {
    listGoogleAccounts,
    readGoogleAccount,
    removeGoogleAccount,
    saveGoogleAccount,
    updateGoogleAccountToken
} from '../src/google';
import {
    addGoogleAccountGroupMember,
    createGoogleAccountGroup,
    deleteGoogleAccountGroup,
    listGoogleAccountGroups,
    removeGoogleAccountGroupMember,
    renameGoogleAccountGroup
} from '../src/groups';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const describeDatabase = describe.skipIf(!databaseUrl);

describeDatabase('authenticated Google accounts and groups', () => {
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

    test('accounts, groups, and metadata stay isolated across users and accounts', async () => {
        const run = Date.now().toString(36);
        const firstUser = `user-one-${run}`;
        const secondUser = `user-two-${run}`;

        await db.insert(user).values([
            { id: firstUser, name: 'First', email: `one-${run}@example.com` },
            { id: secondUser, name: 'Second', email: `two-${run}@example.com` }
        ]);

        const first = (
            await saveGoogleAccount(context, firstUser, {
                email: 'one-a@example.com',
                token: 'aas_et/one-a'
            })
        ).unwrap();
        const second = (
            await saveGoogleAccount(context, firstUser, {
                email: 'one-b@example.com',
                token: 'aas_et/one-b'
            })
        ).unwrap();
        const third = (
            await saveGoogleAccount(context, secondUser, {
                email: 'two-a@example.com',
                token: 'aas_et/two-a'
            })
        ).unwrap();

        const family = (await createGoogleAccountGroup(context, firstUser, 'Family')).unwrap();
        const shared = (await createGoogleAccountGroup(context, firstUser, 'Shared')).unwrap();
        const work = (await createGoogleAccountGroup(context, secondUser, 'Work')).unwrap();

        for (const [userId, groupId, accountId] of [
            [firstUser, family.id, first.id],
            [firstUser, family.id, second.id],
            [firstUser, shared.id, first.id],
            [secondUser, work.id, third.id]
        ] as const)
            expect(
                (await addGoogleAccountGroupMember(context, userId, groupId, accountId)).isOk()
            ).toBe(true);

        const crossUser = await addGoogleAccountGroupMember(
            context,
            firstUser,
            family.id,
            third.id
        );
        expect(crossUser.unwrapErr().code).toBe('GROUP_MEMBER_INVALID');

        const firstGroups = (await listGoogleAccountGroups(context, firstUser)).unwrap();
        expect(firstGroups.map((group) => group.name).sort()).toEqual(['Family', 'Shared']);
        expect(firstGroups.find((group) => group.id === family.id)?.members).toHaveLength(2);
        expect((await listGoogleAccountGroups(context, secondUser)).unwrap()).toHaveLength(1);
        expect(
            (await listGoogleAccounts(context, firstUser)).unwrap().map((account) => account.id)
        ).not.toContain(third.id);
        expect(
            (await renameGoogleAccountGroup(context, firstUser, work.id, 'Hijacked')).unwrapErr()
                .code
        ).toBe('GROUP_NOT_FOUND');
        expect((await deleteGoogleAccountGroup(context, firstUser, work.id)).unwrap()).toBe(false);

        const firstStore = createChunkMetadataStore(db, {
            userId: firstUser,
            googleAccountId: first.id
        });
        const secondStore = createChunkMetadataStore(db, {
            userId: firstUser,
            googleAccountId: second.id
        });
        const thirdStore = createChunkMetadataStore(db, {
            userId: secondUser,
            googleAccountId: third.id
        });
        const record = (fileId: string, folder?: string, storedSize?: number) => ({
            mediaKey: 'shared-media',
            sha1: '1'.repeat(40),
            storedBmpSize: 120,
            fileHash: 'a'.repeat(64),
            fileId,
            chunkIndex: 0,
            isLast: true,
            originalName: 'photo.jpg',
            ...(folder ? { folder } : {}),
            ...(storedSize === undefined ? {} : { storedSize }),
            size: 60
        });

        await firstStore.save([record('first-file')]);
        await secondStore.save([record('second-file', 'Projects/2026', 42)]);
        await thirdStore.save([record('third-file')]);

        const candidate = { mediaKey: 'shared-media', sha1: '1'.repeat(40), size: 120, at: 1 };
        expect((await firstStore.load([candidate])).unwrap().get('shared-media')).toMatchObject({
            fileId: 'first-file'
        });
        expect((await firstStore.load([candidate])).unwrap().get('shared-media')?.folder).toBe(
            undefined
        );
        expect((await secondStore.load([candidate])).unwrap().get('shared-media')).toMatchObject({
            fileId: 'second-file',
            folder: 'Projects/2026',
            storedSize: 42
        });
        expect((await thirdStore.load([candidate])).unwrap().get('shared-media')).toMatchObject({
            fileId: 'third-file'
        });

        const reconnected = (
            await saveGoogleAccount(context, firstUser, {
                email: 'one-b@example.com',
                token: 'aas_et/one-b-refreshed'
            })
        ).unwrap();
        expect(reconnected.id).toBe(second.id);
        expect((await secondStore.load([candidate])).unwrap().has('shared-media')).toBe(true);

        expect(
            (
                await updateGoogleAccountToken(
                    context,
                    firstUser,
                    second.id,
                    'aas_et/one-b-updated'
                )
            ).isOk()
        ).toBe(true);
        const stored = (await readGoogleAccount(context, firstUser, second.id)).unwrap();
        expect(stored.email).toBe('one-b@example.com');
        expect(stored.token).toBe('aas_et/one-b-updated');
        expect((await secondStore.load([candidate])).unwrap().has('shared-media')).toBe(true);

        expect(
            (await removeGoogleAccountGroupMember(context, firstUser, family.id, first.id)).isOk()
        ).toBe(true);
        expect(
            (await listGoogleAccountGroups(context, firstUser))
                .unwrap()
                .find((group) => group.id === family.id)
                ?.members.map((member) => member.id)
        ).toEqual([second.id]);

        expect((await removeGoogleAccount(context, firstUser, first.id)).isOk()).toBe(true);
        const afterDisconnect = (await listGoogleAccountGroups(context, firstUser)).unwrap();
        expect(afterDisconnect.map((group) => group.name).sort()).toEqual(['Family', 'Shared']);
        expect(afterDisconnect.find((group) => group.id === shared.id)?.members).toEqual([]);
        expect((await firstStore.load([candidate])).unwrap().size).toBe(0);
        expect((await secondStore.load([candidate])).unwrap().size).toBe(1);

        expect((await deleteGoogleAccountGroup(context, firstUser, shared.id)).isOk()).toBe(true);
        expect(
            (await listGoogleAccountGroups(context, firstUser)).unwrap().map((group) => group.name)
        ).toEqual(['Family']);

        const rows = await db
            .select()
            .from(chunkMetadata)
            .where(eq(chunkMetadata.userId, firstUser));
        expect(rows).toHaveLength(1);

        await db.delete(user).where(eq(user.id, firstUser));

        expect(
            await db.select().from(chunkMetadata).where(eq(chunkMetadata.userId, firstUser))
        ).toHaveLength(0);
        expect(
            await db.select().from(chunkMetadata).where(eq(chunkMetadata.userId, secondUser))
        ).toHaveLength(1);
        expect((await listGoogleAccountGroups(context, secondUser)).unwrap()).toHaveLength(1);
    });

    test('one user can route across three accounts and two groups without crossing users', async () => {
        const run = Date.now().toString(36);
        const userId = `user-${run}`;
        const foreignUser = `foreign-${run}`;

        await db.insert(user).values([
            { id: userId, name: 'Owner', email: `owner-${run}@example.com` },
            { id: foreignUser, name: 'Foreign', email: `foreign-${run}@example.com` }
        ]);

        const accounts = [];
        for (const [index, email] of ['one', 'two', 'three'].entries())
            accounts.push(
                (
                    await saveGoogleAccount(context, userId, {
                        email: `${email}-${run}@example.com`,
                        token: `aas_et/${email}`
                    })
                ).unwrap()
            );

        const foreign = (
            await saveGoogleAccount(context, foreignUser, {
                email: `foreign-account-${run}@example.com`,
                token: 'aas_et/foreign'
            })
        ).unwrap();

        const groupA = (await createGoogleAccountGroup(context, userId, 'A')).unwrap();
        const groupB = (await createGoogleAccountGroup(context, userId, 'B')).unwrap();
        for (const [groupId, accountId] of [
            [groupA.id, accounts[0]!.id],
            [groupA.id, accounts[1]!.id],
            [groupB.id, accounts[1]!.id],
            [groupB.id, accounts[2]!.id]
        ] as const)
            expect(
                (await addGoogleAccountGroupMember(context, userId, groupId, accountId)).isOk()
            ).toBe(true);

        const groups = (await listGoogleAccountGroups(context, userId)).unwrap();
        expect(groups.map((group) => group.name).sort()).toEqual(['A', 'B']);
        expect(groups.find((group) => group.id === groupA.id)?.members).toHaveLength(2);
        expect(groups.find((group) => group.id === groupB.id)?.members).toHaveLength(2);

        for (const account of accounts) {
            const selected = (await readGoogleAccount(context, userId, account.id)).unwrap();
            expect(selected.id).toBe(account.id);
            expect(selected.email).toBe(account.email);
        }

        const foreignRead = await readGoogleAccount(context, userId, foreign.id);
        expect(foreignRead.unwrapErr().code).toBe('GOOGLE_ACCOUNT_NOT_FOUND');
    });
});
