import { eq, sql } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { splitBmpByteLength, splitHeaderByteLength } from '@madkarmaa/phodrive-core/bmp/format';
import { ShareChunkSessionSchema, PublicShareSchema } from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS, type ServerError } from '@madkarmaa/phodrive-core/server/errors';
import type { Database } from '../src/db/client';
import { share, shareFile } from '../src/db/schema';
import {
    SHARE_CAPABILITY_TTL_MS,
    createShare,
    getPublicShare,
    issueShareChunk,
    revokeShare
} from '../src/shares';
import { decodeCapability } from './helpers/capability';
import { TEST_CAPABILITY_KEY } from './helpers/context';
import {
    MEDIA,
    connectedAccount,
    createUser,
    deferred,
    fileRequest,
    rejected,
    resolved,
    shareDatabase,
    singleSource
} from './helpers/shares';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const FILE_ID = '1'.repeat(64);
const prepareUrl = () => resolved(new URL(MEDIA));

describe.skipIf(!databaseUrl)('public share reads', () => {
    const state = shareDatabase(databaseUrl);

    async function activeShare() {
        const { db, context } = state;
        const userId = await createUser(db, 'viewer');
        const { email, id: accountId } = await connectedAccount(context, userId, 'viewer');
        const created = (
            await createShare(
                context,
                userId,
                fileRequest(email, FILE_ID),
                singleSource(email, FILE_ID, 'Private/Parent', 'kept', 2)
            )
        ).unwrap();
        const [file] = await db.select().from(shareFile).where(eq(shareFile.shareId, created.id));

        return {
            userId,
            accountId,
            created,
            file: file!,
            token: created.publicPath.split('/').pop()!
        };
    }

    test('the manifest holds only the public fields', async () => {
        const { file, token } = await activeShare();

        const manifest = (await getPublicShare(state.context, token)).unwrap();

        expect(PublicShareSchema.safeParse(manifest).success).toBe(true);
        expect(manifest.files).toEqual([
            {
                id: file.id,
                fileHash: file.fileHash,
                name: file.name,
                relativeFolder: 'kept',
                chunkCount: 2,
                size: 20
            }
        ]);

        const body = JSON.stringify(manifest);
        expect(body).not.toContain('Private');
        expect(body).not.toContain(FILE_ID);
        expect(body).not.toContain('google.example');
    });

    test('issues a five-minute capability bound to the chunk and its payload', async () => {
        const { created, file, token } = await activeShare();
        const now = Date.UTC(2026, 10, 5, 12, 0, 0);
        const prepare = vi.fn(prepareUrl);

        const session = (
            await issueShareChunk(state.context, token, file.id, 0, {
                prepareUrl: prepare,
                now: () => now
            })
        ).unwrap();

        expect(ShareChunkSessionSchema.parse(session).chunk).toEqual({
            index: 0,
            size: 10,
            isLast: false
        });
        expect(JSON.stringify(session.chunk)).not.toContain('b'.repeat(40));
        expect(session.url).toBe('https://edge.example/api/bytes');
        expect(prepare).toHaveBeenCalledTimes(1);

        const expiry = Math.floor((now + SHARE_CAPABILITY_TTL_MS) / 1000);
        expect(new Date(session.expiresAt).getTime()).toBe(expiry * 1000);

        const header = {
            fileHash: file.fileHash,
            fileId: FILE_ID,
            chunkIndex: 0,
            flags: 0 as const,
            payloadSize: 10,
            fileName: file.name,
            folder: 'Private/Parent'
        };
        expect(decodeCapability(session.capability, TEST_CAPABILITY_KEY).unwrap()).toEqual({
            v: 1,
            s: created.id,
            f: file.id,
            c: 0,
            u: MEDIA,
            o: splitHeaderByteLength(header).unwrap(),
            p: 10,
            n: splitBmpByteLength(header).unwrap(),
            e: expiry
        });
    });

    test('later chunks carry no name or folder in their prefix offset', async () => {
        const { file, token } = await activeShare();

        const session = (
            await issueShareChunk(state.context, token, file.id, 1, { prepareUrl })
        ).unwrap();

        const offset = splitHeaderByteLength({
            fileHash: file.fileHash,
            fileId: FILE_ID,
            chunkIndex: 1,
            flags: 1,
            payloadSize: 10
        }).unwrap();
        expect(session.chunk.isLast).toBe(true);
        expect(decodeCapability(session.capability, TEST_CAPABILITY_KEY).unwrap().o).toBe(offset);
    });

    test('a capability fails authentication once tampered', async () => {
        const { file, token } = await activeShare();
        const { capability } = (
            await issueShareChunk(state.context, token, file.id, 0, { prepareUrl })
        ).unwrap();
        const tampered = `${capability.slice(0, 10)}${capability[10] === 'A' ? 'B' : 'A'}${capability.slice(11)}`;

        expect(decodeCapability(tampered, TEST_CAPABILITY_KEY).isErr()).toBe(true);
    });

    test('unknown files, chunks and malformed indexes issue nothing', async () => {
        const { file, token } = await activeShare();
        const prepare = vi.fn(prepareUrl);
        const issue = (fileId: string, index: number) =>
            issueShareChunk(state.context, token, fileId, index, { prepareUrl: prepare });

        for (const [fileId, index] of [
            ['missing', 0],
            [file.id, 2],
            [file.id, -1],
            [file.id, 1.5],
            [file.id, Number.NaN],
            [file.id, 2 ** 40]
        ] as const)
            expect((await issue(fileId, index)).unwrapErr()).toEqual(
                SERVER_ERRORS.SHARE_FILE_NOT_FOUND
            );

        expect(prepare).not.toHaveBeenCalled();
    });

    test('a file id from another share issues nothing', async () => {
        const { file } = await activeShare();
        const { db, context } = state;
        const other = await createUser(db, 'other');
        const { email } = await connectedAccount(context, other, 'other');
        const created = await createShare(
            context,
            other,
            fileRequest(email, '2'.repeat(64)),
            singleSource(email, '2'.repeat(64))
        );
        const token = created.unwrap().publicPath.split('/').pop()!;

        const issued = await issueShareChunk(context, token, file.id, 0, { prepareUrl });

        expect(issued.unwrapErr()).toEqual(SERVER_ERRORS.SHARE_FILE_NOT_FOUND);
    });

    test('a revoked share serves no manifest or capability', async () => {
        const { userId, created, file, token } = await activeShare();

        await revokeShare(state.context, userId, created.id);

        expect((await getPublicShare(state.context, token)).unwrapErr()).toEqual(
            SERVER_ERRORS.SHARE_NOT_FOUND
        );
        expect(
            (await issueShareChunk(state.context, token, file.id, 0, { prepareUrl })).unwrapErr()
        ).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
    });

    test('a revoke during media resolution stops the capability', async () => {
        const { userId, created, file, token } = await activeShare();
        const started = deferred();
        const resume = deferred();

        const pending = issueShareChunk(state.context, token, file.id, 0, {
            prepareUrl: () =>
                Ok(undefined).andThenAsync<URL, ServerError>(async () => {
                    started.resolve();
                    await resume.promise;

                    return Ok(new URL(MEDIA));
                })
        });

        await started.promise;
        const revoked = await revokeShare(state.context, userId, created.id);
        expect(revoked.unwrap().status).toBe('revoked');

        resume.resolve();
        expect((await pending).unwrapErr()).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
    });

    async function waitForBlockedQuery(fragment: string) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const rows = await state.db.execute(
                sql`select 1 from pg_stat_activity
                    where datname = current_database()
                      and wait_event_type = 'Lock'
                      and query ilike ${`%${fragment}%`}`
            );
            if (rows.length) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        throw new Error(`No query blocked on ${fragment}`);
    }

    test('a revoke that holds the row first stops an issuance already past Google', async () => {
        const { created, file, token } = await activeShare();
        const lockHeld = deferred();
        const commit = deferred();

        const revoking = state.db.transaction(async (tx) => {
            await tx.update(share).set({ status: 'revoked' }).where(eq(share.id, created.id));
            lockHeld.resolve();
            await commit.promise;
        });
        await lockHeld.promise;

        const issuing = issueShareChunk(state.context, token, file.id, 0, { prepareUrl });
        await waitForBlockedQuery('for share');
        commit.resolve();
        await revoking;

        expect((await issuing).unwrapErr()).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
    });

    test('an issuance that holds the row first finishes before the revoke commits', async () => {
        const { userId, created, file, token } = await activeShare();
        const lockHeld = deferred();
        const commit = deferred();
        const holdsCommit = new Proxy(state.db, {
            get(target, property, receiver) {
                if (property !== 'transaction') return Reflect.get(target, property, receiver);

                return (run: Parameters<Database['transaction']>[0]) =>
                    target.transaction(async (tx) => {
                        const value = await run(tx);
                        lockHeld.resolve();
                        await commit.promise;

                        return value;
                    });
            }
        });

        const issuing = issueShareChunk({ ...state.context, db: holdsCommit }, token, file.id, 0, {
            prepareUrl
        });
        await lockHeld.promise;

        const concurrent = await issueShareChunk(state.context, token, file.id, 0, { prepareUrl });
        expect(concurrent.isOk()).toBe(true);

        let revokeSettled = false;
        const revoking = revokeShare(state.context, userId, created.id).then((result) => {
            revokeSettled = true;

            return result;
        });
        await waitForBlockedQuery('update "share"');
        expect(revokeSettled).toBe(false);

        commit.resolve();
        expect((await issuing).isOk()).toBe(true);
        expect((await revoking).unwrap().status).toBe('revoked');
        expect(
            (await issueShareChunk(state.context, token, file.id, 0, { prepareUrl })).unwrapErr()
        ).toEqual(SERVER_ERRORS.SHARE_NOT_FOUND);
    });

    test('a cooldown answers at once with its retry delay, without calling Google', async () => {
        const { file, token, accountId } = await activeShare();
        state.context.throttle.pause(accountId, 600);

        const issued = await issueShareChunk(state.context, token, file.id, 0);

        expect(issued.unwrapErr()).toMatchObject({
            code: 'THROTTLED',
            retryAfterSeconds: expect.any(Number)
        });
        state.context.throttle.clear(accountId);
    });

    test('a cooldown that starts during media resolution also answers at once', async () => {
        const { file, token, accountId } = await activeShare();

        const issued = await issueShareChunk(state.context, token, file.id, 0, {
            prepareUrl: (_email, _token, _key, _sha1, _fetcher, _signal, scope) => {
                state.context.throttle.pause(accountId, 600);

                return Ok(undefined).andThenAsync<URL, ServerError>(async () => {
                    try {
                        await scope!.coordinator.wait(scope!.key);

                        return Ok(new URL(MEDIA));
                    } catch {
                        return Err(SERVER_ERRORS.UPLOAD_CANCELLED);
                    }
                });
            }
        });

        expect(issued.unwrapErr().code).toBe('THROTTLED');
        state.context.throttle.clear(accountId);
    });

    test('media failures are controlled, and throttling keeps its retry hint', async () => {
        const { file, token } = await activeShare();
        const issue = (error: ServerError) =>
            issueShareChunk(state.context, token, file.id, 0, {
                prepareUrl: () => rejected(error)
            });

        expect((await issue(SERVER_ERRORS.INVALID_DOWNLOAD_URL)).unwrapErr()).toEqual(
            SERVER_ERRORS.SHARE_MEDIA_UNAVAILABLE
        );

        const throttled = {
            code: 'THROTTLED',
            message: 'Slow down.',
            retryAfterSeconds: 30
        } as const;
        expect((await issue(throttled)).unwrapErr()).toEqual(throttled);
    });
});
