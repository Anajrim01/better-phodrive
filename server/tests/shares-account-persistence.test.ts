import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { createAuth } from '../src/auth';
import { googleAccount, session, share, shareChunk, shareFile } from '../src/db/schema';
import { readGoogleAccountByEmail, removeGoogleAccount, saveGoogleAccount } from '../src/google';
import { createShare, getPublicShare, issueShareChunk, revokeShare } from '../src/shares';
import { callWith } from './helpers/api';
import { TEST_ENVIRONMENT } from './helpers/context';
import {
    MEDIA,
    createUser,
    fileRequest,
    folderRequest,
    resolved,
    shareDatabase,
    singleSource,
    snapshotFile,
    snapshotOf
} from './helpers/shares';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';

const FILE_ID = '1'.repeat(64);
const EMAIL = 'owner@google.example';
const prepareUrl = () => resolved(new URL(MEDIA));

describe.skipIf(!databaseUrl)('shares outlive their Google account row', () => {
    const state = shareDatabase(databaseUrl);

    async function connect(userId: string, email = EMAIL, token = 'oauth2_first') {
        const saved = await saveGoogleAccount(state.context, userId, { email, token });

        return saved.unwrap();
    }

    async function activeShare(userId: string) {
        const { db, context } = state;
        const account = await connect(userId);
        const created = await createShare(
            context,
            userId,
            fileRequest(account.id, FILE_ID),
            singleSource(account.email, FILE_ID)
        );
        const summary = created.unwrap();
        const token = summary.publicPath.split('/').pop()!;
        const [file] = await db.select().from(shareFile).where(eq(shareFile.shareId, summary.id));

        return { account, summary, token, file: file! };
    }

    async function shareRows(shareId: string) {
        const { db } = state;
        const [row] = await db.select().from(share).where(eq(share.id, shareId));

        return {
            row,
            files: await db.select().from(shareFile).where(eq(shareFile.shareId, shareId)),
            chunks: await db.select().from(shareChunk).where(eq(shareChunk.shareId, shareId))
        };
    }

    test('disconnecting keeps every row and the manifest, and pauses chunks', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'removed');
        const { account, summary, token, file } = await activeShare(userId);
        const before = await shareRows(summary.id);

        expect((await removeGoogleAccount(context, userId, account.id)).unwrap()).toBe(true);

        expect(await db.select().from(googleAccount)).toHaveLength(0);
        expect(await shareRows(summary.id)).toEqual(before);

        const manifest = await getPublicShare(context, token);
        expect(manifest.unwrap().files.map((current) => current.id)).toEqual([file.id]);

        const chunk = await issueShareChunk(context, token, file.id, 0, { prepareUrl });
        expect(chunk.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_ACCOUNT_DISCONNECTED);
    });

    test('re-adding the same normalized email restores chunks with the new token', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'returned');
        const { account, token, file } = await activeShare(userId);
        await removeGoogleAccount(context, userId, account.id);

        const returned = await connect(userId, EMAIL.toUpperCase(), 'oauth2_second');
        expect(returned.id).not.toBe(account.id);
        expect(returned.email).toBe(EMAIL);

        const prepare = vi.fn(prepareUrl);
        const chunk = await issueShareChunk(context, token, file.id, 0, { prepareUrl: prepare });

        expect(chunk.unwrap().chunk.index).toBe(0);
        expect(prepare.mock.calls[0]).toEqual(expect.arrayContaining([EMAIL, 'oauth2_second']));
    });

    test('revoke succeeds while disconnected and reconnecting cannot revive the share', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'revoke-away');
        const { account, summary, token, file } = await activeShare(userId);
        await removeGoogleAccount(context, userId, account.id);

        const revoked = await revokeShare(context, userId, summary.id);
        expect(revoked.unwrap()).toMatchObject({ status: 'revoked' });
        expect(revoked.unwrap().revokedAt).not.toBeNull();

        await connect(userId, EMAIL, 'oauth2_second');

        expect((await shareRows(summary.id)).row?.status).toBe('revoked');
        expect((await getPublicShare(context, token)).unwrapErr()).toEqual(
            SERVER_ERRORS.SHARE_NOT_FOUND
        );
        expect(
            (await issueShareChunk(context, token, file.id, 0, { prepareUrl })).unwrapErr()
        ).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
    });

    test('a repeated revoke keeps the first revocation time', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'repeat');
        const { summary } = await activeShare(userId);

        const first = await revokeShare(context, userId, summary.id);
        const second = await revokeShare(context, userId, summary.id);

        expect(second.unwrap()).toEqual(first.unwrap());
    });

    test('revoke while sharing is off survives re-enabling and account reconnect', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'disabled-revoke');
        const { account, summary, token } = await activeShare(userId);
        await removeGoogleAccount(context, userId, account.id);
        const disabled = { ...context, env: { ...context.env, sharing: null } };
        expect((await revokeShare(disabled, userId, summary.id)).unwrap().status).toBe('revoked');
        await connect(userId);
        expect((await getPublicShare(context, token)).unwrapErr()).toBe(
            SERVER_ERRORS.SHARE_NOT_FOUND
        );
        expect((await shareRows(summary.id)).row?.status).toBe('revoked');
    });

    test('one disconnected group member pauses only its own files', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'group');
        const first = await connect(userId, 'first@google.example');
        const second = await connect(userId, 'second@google.example');
        const created = await createShare(
            context,
            userId,
            folderRequest('group-id'),
            snapshotOf(
                [first, second].map(({ email }, index) => ({
                    accountEmail: email,
                    files: [
                        {
                            snapshot: snapshotFile(email, `${index}`.repeat(64), ''),
                            relativeFolder: ''
                        }
                    ]
                }))
            )
        );
        const summary = created.unwrap();
        const token = summary.publicPath.split('/').pop()!;
        await removeGoogleAccount(context, userId, first.id);

        const files = await db.select().from(shareFile).where(eq(shareFile.shareId, summary.id));
        const fileOf = (email: string) =>
            files.find((file) => file.googleAccountEmail === email)!.id;

        expect(
            (
                await issueShareChunk(context, token, fileOf(first.email), 0, { prepareUrl })
            ).unwrapErr()
        ).toEqual(SERVER_ERRORS.SHARE_ACCOUNT_DISCONNECTED);
        expect(
            (await issueShareChunk(context, token, fileOf(second.email), 0, { prepareUrl })).isOk()
        ).toBe(true);
    });

    test('another user connecting the same email gains nothing', async () => {
        const { db, context } = state;
        const owner = await createUser(db, 'owner');
        const { account, summary, token, file } = await activeShare(owner);
        await removeGoogleAccount(context, owner, account.id);

        const other = await createUser(db, 'other');
        await connect(other, EMAIL, 'oauth2_other');

        const chunk = await issueShareChunk(context, token, file.id, 0, { prepareUrl });
        expect(chunk.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_ACCOUNT_DISCONNECTED);

        const revoked = await revokeShare(context, other, summary.id);
        expect(revoked.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
        expect((await shareRows(summary.id)).row?.status).toBe('active');
    });

    test('the email lookup is normalized and scoped to the user', async () => {
        const { db, context } = state;
        const userId = await createUser(db, 'lookup');
        const other = await createUser(db, 'lookup-other');
        const saved = await connect(userId);

        const found = await readGoogleAccountByEmail(context, userId, EMAIL.toUpperCase());
        expect(found.unwrap()).toEqual({ id: saved.id, email: EMAIL, token: 'oauth2_first' });

        const missing = await readGoogleAccountByEmail(context, other, EMAIL);
        expect(missing.unwrapErr().code).toBe('GOOGLE_ACCOUNT_NOT_FOUND');
    });

    test('signing out ends the session and leaves shares and accounts alone', async () => {
        const { db, context } = state;
        const auth = createAuth({ ...TEST_ENVIRONMENT, BETTER_AUTH_URL: 'http://localhost' }, db);
        const signedUp = await auth.api.signUpEmail({
            body: { name: 'Owner', email: 'owner@example.com', password: 'correct-horse-battery' },
            returnHeaders: true
        });
        const cookie = signedUp.headers.getSetCookie().join('; ');
        const userId = signedUp.response.user.id;
        const { summary, token } = await activeShare(userId);
        const before = await shareRows(summary.id);
        expect(await db.select().from(session)).toHaveLength(1);

        const response = await callWith({ ...context, auth }, '/api/auth/sign-out', {
            method: 'POST',
            headers: { cookie, origin: 'http://localhost', 'content-type': 'application/json' },
            body: '{}'
        });

        expect(response.status).toBe(200);
        expect(await db.select().from(session)).toHaveLength(0);
        expect(await db.select().from(googleAccount)).toHaveLength(1);
        expect(await shareRows(summary.id)).toEqual(before);
        expect((await getPublicShare(context, token)).isOk()).toBe(true);
    });
});
