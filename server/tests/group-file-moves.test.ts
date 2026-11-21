import { beforeEach, describe, expect, test, vi } from 'vitest';
import { requireSessionUser } from '../src/auth';
import { chunkMetadata, fileLocation } from '../src/db/schema';
import {
    addGoogleAccountGroupMember,
    createGoogleAccountGroup,
    removeGoogleAccountGroupMember
} from '../src/groups';
import { callWith, resolved } from './helpers/api';
import { connectedAccount, createUser, shareDatabase } from './helpers/shares';

vi.mock('../src/auth', async (original) => ({
    ...(await original<typeof import('../src/auth')>()),
    requireSessionUser: vi.fn()
}));

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const identity = { fileId: 'a'.repeat(64), mediaKey: 'same-key' };

describe.skipIf(!databaseUrl)('group file moves', () => {
    const state = shareDatabase(databaseUrl);

    async function fixtures() {
        const userId = await createUser(state.db, 'owner');
        const first = await connectedAccount(state.context, userId, 'first');
        const second = await connectedAccount(state.context, userId, 'second');
        const group = (await createGoogleAccountGroup(state.context, userId, 'Archive')).unwrap();
        for (const account of [first, second]) {
            const member = await addGoogleAccountGroupMember(
                state.context,
                userId,
                group.id,
                account.id
            );
            expect(member.isOk()).toBe(true);
        }

        await state.db.insert(chunkMetadata).values(
            [first, second].map((account) => ({
                ...identity,
                userId,
                googleAccountId: account.id,
                storedBmpSize: 3126,
                sha1: 'b'.repeat(40),
                fileHash: 'c'.repeat(64),
                chunkIndex: 0,
                isLast: true,
                originalName: 'original.bin',
                folder: 'Original',
                size: 10
            }))
        );

        vi.mocked(requireSessionUser).mockReturnValue(
            resolved({ id: userId, email: 'owner@example.com' })
        );
        const files = [first, second].map((account) => ({ ...identity, accountId: account.id }));
        return { userId, group, first, second, files };
    }

    function move(groupId: string, body: { folder: string; files: unknown[] }) {
        return callWith(state.context, `/api/account/groups/${groupId}/files/location`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    beforeEach(() => vi.clearAllMocks());

    test('a group move keeps the original owners and preserves a prior rename', async () => {
        const { userId, group, first, second, files } = await fixtures();
        await state.db.insert(fileLocation).values({
            ...identity,
            userId,
            googleAccountEmail: first.email,
            name: 'renamed.bin'
        });

        const moved = await move(group.id, { folder: 'Selected/Nested', files });
        expect(moved.status).toBe(200);
        expect(await moved.json()).toEqual({ updated: true });

        const locations = await state.db.select().from(fileLocation);
        expect(locations).toHaveLength(2);
        expect(locations).toEqual(
            expect.arrayContaining([
                {
                    ...identity,
                    userId,
                    googleAccountEmail: first.email,
                    name: 'renamed.bin',
                    folder: 'Selected/Nested'
                },
                {
                    ...identity,
                    userId,
                    googleAccountEmail: second.email,
                    name: null,
                    folder: 'Selected/Nested'
                }
            ])
        );
        const chunks = await state.db.select().from(chunkMetadata);
        expect(chunks.map((chunk) => chunk.folder)).toEqual(['Original', 'Original']);
    });

    test('a stale file prevents any location edit in the batch', async () => {
        const { group, files } = await fixtures();
        const stale = { ...files[1], mediaKey: 'key-replaced-after-selection' };
        expect((await move(group.id, { folder: '', files: [files[0], stale] })).status).toBe(404);
        expect(await state.db.select().from(fileLocation)).toHaveLength(0);
    });

    test('removing a member invalidates its selected files and keeps the batch atomic', async () => {
        const { userId, group, second, files } = await fixtures();
        const removed = await removeGoogleAccountGroupMember(
            state.context,
            userId,
            group.id,
            second.id
        );
        expect(removed.isOk()).toBe(true);

        expect((await move(group.id, { folder: '', files })).status).toBe(404);
        expect(await state.db.select().from(fileLocation)).toHaveLength(0);
    });

    test('another signed-in user cannot move files through the group ID', async () => {
        const { group, files } = await fixtures();
        const outsider = await createUser(state.db, 'outsider');
        vi.mocked(requireSessionUser).mockReturnValue(
            resolved({ id: outsider, email: 'outsider@example.com' })
        );

        expect((await move(group.id, { folder: '', files })).status).toBe(404);
        expect(await state.db.select().from(fileLocation)).toHaveLength(0);
    });
});
