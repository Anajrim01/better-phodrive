import { and, eq, inArray, sql } from 'drizzle-orm';
import { Err, Ok, type Result } from 'results-ts';
import type {
    AccountFileLocationEdit,
    FileLocationEdit,
    GroupMoveRequest
} from '@madkarmaa/phodrive-core/models';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import type { Database } from './db/client';
import { chunkMetadata, fileLocation, googleAccount, googleAccountGroupMember } from './db/schema';
import { AUTH_ERRORS } from './errors';

const FILE_NOT_FOUND = {
    code: 'FILE_NOT_FOUND',
    message: 'One or more selected files could not be found.',
    status: 404
} as const;

type LocationScope = { userId: string; googleAccountId: string; googleAccountEmail: string };
type LocationError =
    | typeof FILE_NOT_FOUND
    | typeof SERVER_ERRORS.FILE_LOCATION_UNAVAILABLE
    | typeof AUTH_ERRORS.GROUP_MEMBER_INVALID;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type LocationWrite = AccountFileLocationEdit & { googleAccountEmail: string };

function commitLocations(
    db: Database,
    write: (tx: Transaction) => Promise<Result<void, LocationError>>
) {
    return Ok(undefined).andThenAsync(async (): Promise<Result<void, LocationError>> => {
        try {
            return await db.transaction(write);
        } catch {
            return Err(SERVER_ERRORS.FILE_LOCATION_UNAVAILABLE);
        }
    });
}

async function updateLocations(tx: Transaction, userId: string, edits: readonly LocationWrite[]) {
    const known = await tx
        .select({
            accountId: chunkMetadata.googleAccountId,
            mediaKey: chunkMetadata.mediaKey,
            fileId: chunkMetadata.fileId
        })
        .from(chunkMetadata)
        .where(
            and(
                eq(chunkMetadata.userId, userId),
                eq(chunkMetadata.chunkIndex, 0),
                inArray(
                    chunkMetadata.googleAccountId,
                    edits.map((edit) => edit.accountId)
                ),
                inArray(
                    chunkMetadata.mediaKey,
                    edits.map((edit) => edit.mediaKey)
                )
            )
        )
        .for('share');
    const knownFiles = new Set(
        known.map(({ accountId, fileId, mediaKey }) => `${accountId}:${fileId}:${mediaKey}`)
    );
    if (
        edits.some(
            ({ accountId, fileId, mediaKey }) =>
                !knownFiles.has(`${accountId}:${fileId}:${mediaKey}`)
        )
    )
        return Err(FILE_NOT_FOUND);

    // Acquire overlapping upsert keys in the same order for concurrent moves.
    const rows = edits
        .map(({ googleAccountEmail, mediaKey, fileId, name, folder }) => ({
            userId,
            googleAccountEmail,
            mediaKey,
            fileId,
            name,
            folder
        }))
        .sort(
            (first, second) =>
                first.googleAccountEmail.localeCompare(second.googleAccountEmail) ||
                first.fileId.localeCompare(second.fileId)
        );
    await tx
        .insert(fileLocation)
        .values(rows)
        .onConflictDoUpdate({
            target: [
                fileLocation.userId,
                fileLocation.googleAccountEmail,
                fileLocation.mediaKey,
                fileLocation.fileId
            ],
            set: {
                name: sql`coalesce(excluded.name, ${fileLocation.name})`,
                folder: sql`coalesce(excluded.folder, ${fileLocation.folder})`
            }
        });

    return Ok(undefined);
}

export function saveFileLocations(
    db: Database,
    { userId, googleAccountId, googleAccountEmail }: LocationScope,
    edits: readonly FileLocationEdit[]
) {
    const scoped = edits.map((edit) => ({
        ...edit,
        accountId: googleAccountId,
        googleAccountEmail
    }));
    return commitLocations(db, (tx) => updateLocations(tx, userId, scoped));
}

/** Keep membership stable until every file has been checked and the move commits. */
export function moveGroupFiles(
    db: Database,
    userId: string,
    groupId: string,
    { folder, files }: GroupMoveRequest
) {
    return commitLocations(db, async (tx) => {
        const accounts = await tx
            .select({ id: googleAccount.id, email: googleAccount.email })
            .from(googleAccountGroupMember)
            .innerJoin(
                googleAccount,
                and(
                    eq(googleAccount.userId, googleAccountGroupMember.userId),
                    eq(googleAccount.id, googleAccountGroupMember.googleAccountId)
                )
            )
            .where(
                and(
                    eq(googleAccountGroupMember.userId, userId),
                    eq(googleAccountGroupMember.groupId, groupId),
                    inArray(
                        googleAccountGroupMember.googleAccountId,
                        files.map((file) => file.accountId)
                    )
                )
            )
            .for('share');
        const emailById = new Map(accounts.map(({ id, email }) => [id, email]));
        const edits: LocationWrite[] = [];
        for (const file of files) {
            const googleAccountEmail = emailById.get(file.accountId);
            if (!googleAccountEmail) return Err(AUTH_ERRORS.GROUP_MEMBER_INVALID);
            edits.push({ ...file, googleAccountEmail, folder });
        }

        return updateLocations(tx, userId, edits);
    });
}
