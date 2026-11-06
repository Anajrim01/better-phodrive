import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { CreateShareRequest } from '@madkarmaa/phodrive-core/models';
import type { FileGroup } from '@madkarmaa/phodrive-core/file-groups';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos';
import type { SnapshotFile } from '@madkarmaa/phodrive-core/server/photos/shares';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import type { ServerContext } from '../../src/context';
import { createDatabase, type Database } from '../../src/db/client';
import { migrateDatabase } from '../../src/db/migrate';
import { user } from '../../src/db/schema';
import { saveGoogleAccount } from '../../src/google';
import type { ShareError, ShareServiceOptions, ShareSnapshot } from '../../src/shares';
import { TEST_ENVIRONMENT } from './context';

export const HASH = 'a'.repeat(64);
export const MEDIA = 'https://lh3.googleusercontent.com/pw/abcdefghijklmnopqrstuvwxyz0123456789';

export function resolved<T>(value: T): AsyncResult<T, ServerError> {
    return Ok(value).andThenAsync(async (current) => Ok(current));
}

export function rejected(error: ServerError): AsyncResult<never, ServerError> {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

export function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

export function contextFor(db: Database): ServerContext {
    return {
        db,
        env: TEST_ENVIRONMENT,
        throttle: createThrottleCoordinator(() => 0.5)
    } as ServerContext;
}

// These tests share one database, so vitest.config.ts runs files serially when it is configured.
export function shareDatabase(databaseUrl: string) {
    const state = {} as { db: Database; context: ServerContext };

    beforeAll(async () => {
        const migrated = await migrateDatabase(
            databaseUrl,
            fileURLToPath(new URL('../../drizzle', import.meta.url))
        );
        expect(migrated.isOk()).toBe(true);
        state.db = createDatabase(databaseUrl);
        state.context = contextFor(state.db);
    });

    beforeEach(async () => {
        await state.db.delete(user);
    });

    afterAll(async () => {
        await state.db.$client.end();
    });

    return state;
}

export function snapshotFile(
    accountEmail: string,
    fileId: string,
    folder: string,
    chunkCount = 1,
    chunkSize = 10
): SnapshotFile {
    const chunks = Array.from({ length: chunkCount }, (_, index) => ({
        fileHash: HASH,
        fileId,
        chunkIndex: index,
        isLast: index === chunkCount - 1,
        size: chunkSize,
        mediaKey: `${fileId}-${index}`,
        sha1: 'b'.repeat(40),
        at: 1,
        accountId: accountEmail,
        email: ''
    }));
    const file: FileGroup = {
        email: '',
        accountId: accountEmail,
        fileHash: HASH,
        fileId,
        name: `${fileId.slice(0, 6)}.bin`,
        folder,
        at: 1,
        chunkCount,
        chunks,
        complete: true
    };

    return {
        accountEmail,
        file,
        relativeFolder: folder,
        size: chunkCount * chunkSize,
        complete: true,
        partialTrash: false,
        invalid: false
    };
}

export function fileRequest(accountId: string, fileId: string): CreateShareRequest {
    return {
        kind: 'file',
        requestKey: randomUUID(),
        name: 'Report',
        context: { kind: 'account', id: accountId },
        accountId,
        fileId
    };
}

export function folderRequest(contextId: string): CreateShareRequest {
    return {
        kind: 'folder',
        requestKey: randomUUID(),
        name: 'Projects',
        context: { kind: 'group', id: contextId },
        folder: 'Projects/2026'
    };
}

export async function createUser(db: Database, suffix: string) {
    const userId = `user-${suffix}`;
    await db.insert(user).values({
        id: userId,
        name: suffix,
        email: `${suffix}@example.com`
    });

    return userId;
}

export async function connectedAccount(context: ServerContext, userId: string, suffix: string) {
    const saved = await saveGoogleAccount(context, userId, {
        email: `${suffix}@google.example`,
        token: `oauth2_${suffix}`
    });

    return saved.unwrap();
}

type SnapshotSources = ShareSnapshot['sources'];

export function snapshotOf(sources: SnapshotSources): ShareServiceOptions {
    return {
        resolveSnapshot: () =>
            Ok(undefined).andThenAsync<ShareSnapshot, ShareError>(async () => Ok({ sources }))
    };
}

export function singleSource(
    accountEmail: string,
    fileId: string,
    folder = '',
    relativeFolder = '',
    chunkCount = 1
): ShareServiceOptions {
    return snapshotOf([
        {
            accountEmail,
            files: [
                { snapshot: snapshotFile(accountEmail, fileId, folder, chunkCount), relativeFolder }
            ]
        }
    ]);
}

export const MUST_NOT_RESCAN: ShareServiceOptions = {
    resolveSnapshot: () => {
        throw new Error('must not rescan');
    }
};
