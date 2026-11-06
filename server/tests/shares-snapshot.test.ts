import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { AccountSnapshot } from '@madkarmaa/phodrive-core/server/photos/shares';
import { addGoogleAccountGroupMember, createGoogleAccountGroup } from '../src/groups';
import { createShare, resolveShareSnapshot } from '../src/shares';
import { connectedAccount, createUser, shareDatabase, snapshotFile } from './helpers/shares';

const { readAccountSnapshot } = vi.hoisted(() => ({ readAccountSnapshot: vi.fn() }));

vi.mock('@madkarmaa/phodrive-core/server/photos/shares', async (original) => ({
    ...(await original<typeof import('@madkarmaa/phodrive-core/server/photos/shares')>()),
    readAccountSnapshot
}));

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';

describe.skipIf(!databaseUrl)('authoritative share snapshots', () => {
    const state = shareDatabase(databaseUrl);

    function accountFiles(byEmail: Record<string, AccountSnapshot['files']>) {
        readAccountSnapshot.mockImplementation(({ email }: { email: string }) =>
            Ok(undefined).andThenAsync(async () =>
                Ok({ accountEmail: email, files: byEmail[email] ?? [] })
            )
        );
    }

    async function group(suffix: string, members: number) {
        const { db, context } = state;
        const userId = await createUser(db, suffix);
        const created = await createGoogleAccountGroup(context, userId, suffix);
        const groupId = created.unwrap().id;
        const emails: string[] = [];
        const ids: string[] = [];

        for (let index = 0; index < members; index++) {
            const account = await connectedAccount(context, userId, `${suffix}-${index}`);
            await addGoogleAccountGroupMember(context, userId, groupId, account.id);
            emails.push(account.email);
            ids.push(account.id);
        }

        return { userId, groupId, emails, ids };
    }

    beforeEach(() => {
        readAccountSnapshot.mockReset();
    });

    test('a group folder aggregates recursive files across members and skips empty ones', async () => {
        const { userId, groupId, emails } = await group('aggregate', 3);
        const [first, second] = emails as [string, string];
        accountFiles({
            [first]: [
                snapshotFile(first, '1'.repeat(64), 'Projects/2026'),
                snapshotFile(first, '2'.repeat(64), 'Elsewhere')
            ],
            [second]: [snapshotFile(second, '3'.repeat(64), 'Projects/2026/src/deep')]
        });

        const snapshot = await resolveShareSnapshot(state.context, userId, {
            kind: 'folder',
            requestKey: crypto.randomUUID(),
            name: 'Projects',
            context: { kind: 'group', id: groupId },
            folder: 'Projects/2026'
        });

        const sources = snapshot.unwrap().sources;
        expect(sources.map((source) => source.accountEmail)).toEqual([first, second]);
        expect(sources[0]?.files.map((file) => file.relativeFolder)).toEqual(['']);
        expect(sources[1]?.files.map((file) => file.relativeFolder)).toEqual(['src/deep']);
    });

    test('one incomplete descendant fails the whole folder share', async () => {
        const { userId, groupId, emails } = await group('incomplete', 1);
        const email = emails[0]!;
        accountFiles({
            [email]: [
                snapshotFile(email, '1'.repeat(64), 'Projects/2026'),
                { ...snapshotFile(email, '2'.repeat(64), 'Projects/2026/src'), complete: false }
            ]
        });

        const created = await createShare(state.context, userId, {
            kind: 'folder',
            requestKey: crypto.randomUUID(),
            name: 'Projects',
            context: { kind: 'group', id: groupId },
            folder: 'Projects/2026'
        });

        expect(created.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_SNAPSHOT_INCOMPLETE);
    });

    test('a file share in a group must name a member of that group', async () => {
        const { userId, groupId } = await group('member', 1);
        const outsider = await connectedAccount(state.context, userId, 'outsider');

        const created = await createShare(state.context, userId, {
            kind: 'file',
            requestKey: crypto.randomUUID(),
            name: 'Report',
            context: { kind: 'group', id: groupId },
            accountId: outsider.id,
            fileId: '1'.repeat(64)
        });

        expect(created.unwrapErr().code).toBe('GOOGLE_ACCOUNT_NOT_FOUND');
        expect(readAccountSnapshot).not.toHaveBeenCalled();
    });

    test('creating a share only reads Google Photos and stores the snapshot', async () => {
        const { userId, ids, emails } = await group('readonly', 1);
        const [id, email] = [ids[0]!, emails[0]!];
        accountFiles({ [email]: [snapshotFile(email, '1'.repeat(64), 'Projects')] });
        const fetched = vi.spyOn(globalThis, 'fetch');

        const created = await createShare(state.context, userId, {
            kind: 'file',
            requestKey: crypto.randomUUID(),
            name: 'Report',
            context: { kind: 'account', id },
            accountId: id,
            fileId: '1'.repeat(64)
        });

        expect(created.unwrap().status).toBe('active');
        expect(readAccountSnapshot).toHaveBeenCalledTimes(1);
        expect(fetched).not.toHaveBeenCalled();

        fetched.mockRestore();
    });
});
