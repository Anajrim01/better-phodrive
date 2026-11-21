import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { splitHeaderByteLength } from '@madkarmaa/phodrive-core/bmp/format';
import {
    GOOGLE_ACCOUNT_HEADER,
    LibraryResponseSchema,
    type FileLocationEdit,
    type RemoteBmp
} from '@madkarmaa/phodrive-core/models';
import { photosFetch } from '@madkarmaa/phodrive-core/server/fetcher';
import { listingPage, splitChunk, type BudgetItem } from '../../core/tests/helpers/library-budget';
import { budgetFetcher, emptyCounts } from '../../core/tests/helpers/library-budget-fetcher';
import { requireSessionUser } from '../src/auth';
import { createDatabase } from '../src/db/client';
import { chunkMetadata, fileLocation } from '../src/db/schema';
import { saveGoogleAccount } from '../src/google';
import { createShare, getPublicShare, issueShareChunk } from '../src/shares';
import { callWith, resolved as sessionResolved } from './helpers/api';
import { decodeCapability } from './helpers/capability';
import { TEST_CAPABILITY_KEY } from './helpers/context';
import { contextFor, createUser, MEDIA, resolved, shareDatabase } from './helpers/shares';

vi.mock('../src/auth', async (original) => ({
    ...(await original<typeof import('../src/auth')>()),
    requireSessionUser: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/fetcher', () => ({ photosFetch: vi.fn() }));

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const ORIGINAL_FOLDER = 'Original/Sub';
const ORIGINAL_NAME = 'original.bin';
function storedFile(mediaKey: string, fileId: string) {
    const fileHash = 'c'.repeat(64);
    const payload = Buffer.from('test bytes');
    const photo = splitChunk({
        mediaKey,
        payload,
        header: {
            fileId,
            fileHash,
            chunkIndex: 0,
            flags: 1,
            payloadSize: payload.length,
            fileName: ORIGINAL_NAME,
            folder: ORIGINAL_FOLDER
        }
    });
    const item = {
        fileId,
        mediaKey,
        sha1: photo.sha1,
        fileHash,
        chunkIndex: 0,
        isLast: true,
        originalName: ORIGINAL_NAME,
        folder: ORIGINAL_FOLDER,
        size: payload.length,
        at: photo.at
    } satisfies RemoteBmp;
    return { item, photo };
}

function mockListing(photos: BudgetItem[]) {
    const pages = new Map([['', listingPage(photos)]]);
    vi.mocked(photosFetch).mockImplementation(budgetFetcher(pages, photos, emptyCounts()));
}

const original = storedFile('chunk-zero', 'a'.repeat(64));
const otherFile = storedFile('sibling', 'd'.repeat(64));
const file = original.item;
const sibling = otherFile.item;
const identity = { fileId: file.fileId, mediaKey: file.mediaKey };

describe.skipIf(!databaseUrl)('file location API', () => {
    const state = shareDatabase(databaseUrl);

    async function connect(userId: string, suffix: string) {
        const result = await saveGoogleAccount(state.context, userId, {
            email: `${suffix}@google.example`,
            token: 'aas_et/local-fixture'
        });
        return result.unwrap();
    }

    async function account(suffix: string) {
        const userId = await createUser(state.db, suffix);
        const account = await connect(userId, suffix);
        await state.db.insert(chunkMetadata).values(
            [original, otherFile].map(({ item: { at: _at, ...chunk }, photo }) => ({
                ...chunk,
                userId,
                googleAccountId: account.id,
                storedBmpSize: photo.size
            }))
        );

        return { userId, ...account };
    }

    function signIn(userId: string) {
        vi.mocked(requireSessionUser).mockReturnValue(
            sessionResolved({ id: userId, email: 'test@example.com' })
        );
    }

    function move(accountId: string, files: FileLocationEdit[]) {
        return callWith(state.context, '/api/files/location', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', [GOOGLE_ACCOUNT_HEADER]: accountId },
            body: JSON.stringify({ files })
        });
    }

    async function library(accountId: string, context = state.context) {
        const response = await callWith(context, '/api/library', {
            method: 'POST',
            headers: { 'content-type': 'application/json', [GOOGLE_ACCOUNT_HEADER]: accountId },
            body: '{}'
        });

        expect(response.status).toBe(200);
        const page = LibraryResponseSchema.parse(await response.json());
        return page.items;
    }

    beforeEach(() => mockListing([original.photo, otherFile.photo]));

    test('concurrent rename and move remain visible through a fresh server connection', async () => {
        const owner = await account('parallel');
        signIn(owner.userId);

        const results = await Promise.all([
            move(owner.id, [{ ...identity, name: 'renamed.bin' }]),
            move(owner.id, [{ ...identity, folder: '' }])
        ]);
        expect(results.map((response) => response.status)).toEqual([200, 200]);

        const reopened = createDatabase(databaseUrl);
        try {
            const [renamed, untouched] = await library(owner.id, contextFor(reopened));
            expect(renamed).toEqual({
                ...file,
                accountId: owner.id,
                displayName: 'renamed.bin',
                displayFolder: ''
            });
            expect(untouched).toEqual({ ...sibling, accountId: owner.id });
        } finally {
            await reopened.$client.end();
        }
    });

    test('folder edits are atomic and scoped to the selected account and file IDs', async () => {
        const owner = await account('batch');
        const other = await connect(owner.userId, 'other');
        signIn(owner.userId);

        const edits = [
            { ...identity, folder: 'Moved/Sub' },
            { fileId: sibling.fileId, mediaKey: sibling.mediaKey, folder: 'Moved/Nested' }
        ];
        expect((await move(other.id, edits)).status).toBe(404);
        const stale = { ...edits[1], mediaKey: 'unknown' };
        expect((await move(owner.id, [edits[0], stale])).status).toBe(404);
        expect(await state.db.select().from(fileLocation)).toHaveLength(0);
        expect((await move(owner.id, edits)).status).toBe(200);
        expect((await library(owner.id)).map((item) => item.displayFolder)).toEqual([
            'Moved/Sub',
            'Moved/Nested'
        ]);
        expect((await library(other.id)).map((item) => item.displayFolder)).toEqual([
            undefined,
            undefined
        ]);

        const outsider = await account('outsider');
        signIn(outsider.userId);
        expect((await move(owner.id, edits)).status).toBe(404);
        expect((await library(outsider.id)).map((item) => item.displayFolder)).toEqual([
            undefined,
            undefined
        ]);
    });

    test('a new stored copy does not inherit the earlier selected file location', async () => {
        const owner = await account('new-copy');
        signIn(owner.userId);
        expect(
            (await move(owner.id, [{ ...identity, name: 'renamed.bin', folder: 'Moved' }])).status
        ).toBe(200);

        const reuploaded = storedFile('new-media-key', file.fileId);
        mockListing([reuploaded.photo]);

        expect(await library(owner.id)).toEqual([{ ...reuploaded.item, accountId: owner.id }]);
    });

    test('a failed database write returns failure without applying any edit', async () => {
        const owner = await account('write-failure');
        signIn(owner.userId);

        await state.db.execute(
            sql`alter table file_location add constraint test_reject_name check (name <> 'reject.bin')`
        );
        try {
            const result = await move(owner.id, [
                { ...identity, name: 'accepted.bin' },
                { fileId: sibling.fileId, mediaKey: sibling.mediaKey, name: 'reject.bin' }
            ]);

            expect(result.status).toBe(503);
            const rows = await state.db
                .select()
                .from(fileLocation)
                .where(eq(fileLocation.userId, owner.userId));
            expect(rows).toHaveLength(0);
        } finally {
            await state.db.execute(sql`alter table file_location drop constraint test_reject_name`);
        }
    });

    test('new shares use the new display path and issue ranges against the stored BMP header', async () => {
        const owner = await account('sharing');
        signIn(owner.userId);
        expect(
            (await move(owner.id, [{ ...identity, name: 'different name.bin', folder: 'Moved' }]))
                .status
        ).toBe(200);

        const created = await createShare(state.context, owner.userId, {
            kind: 'folder',
            requestKey: crypto.randomUUID(),
            name: 'Moved',
            context: { kind: 'account', id: owner.id },
            folder: 'Moved'
        });
        const token = created.unwrap().publicPath.split('/').at(-1)!;
        const manifest = await getPublicShare(state.context, token);
        const publicFiles = manifest.unwrap().files;
        expect(publicFiles).toEqual([
            expect.objectContaining({ name: 'different name.bin', relativeFolder: '' })
        ]);

        const issued = await issueShareChunk(state.context, token, publicFiles[0].id, 0, {
            prepareUrl: () => resolved(new URL(MEDIA))
        });
        const expectedOffset = splitHeaderByteLength({
            fileHash: file.fileHash,
            fileId: file.fileId,
            chunkIndex: 0,
            flags: 1,
            payloadSize: file.size,
            fileName: ORIGINAL_NAME,
            folder: ORIGINAL_FOLDER
        });
        expect(decodeCapability(issued.unwrap().capability, TEST_CAPABILITY_KEY).unwrap().o).toBe(
            expectedOffset.unwrap()
        );
    });
});
