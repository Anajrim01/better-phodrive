import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileActionKind, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { DriveController } from '#browser/drive/index.svelte';
import { useAccount } from '../helpers/drive';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

const ACCOUNT = { id: 'account-owner', email: 'owner@example.com' };
const FILE_HASH = 'a'.repeat(64);

function remoteChunk(overrides: Partial<RemoteBmp> = {}): RemoteBmp {
    return {
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        chunkIndex: 0,
        isLast: false,
        originalName: 'archive.bin',
        folder: 'Projects/2026',
        size: 5,
        at: 1,
        mediaKey: 'first-chunk',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function lastChunk(overrides: Partial<RemoteBmp> = {}): RemoteBmp {
    return remoteChunk({
        chunkIndex: 1,
        isLast: true,
        originalName: undefined,
        folder: undefined,
        mediaKey: 'last-chunk',
        sha1: 'c'.repeat(40),
        ...overrides
    });
}

function driveWith(chunks: RemoteBmp[]): DriveController {
    const drive = new DriveController('owner@example.com');
    drive.initialize();
    useAccount(drive, ACCOUNT);
    drive.library.chunks = chunks.map((item) => ({ ...item, email: ACCOUNT.email }));

    return drive;
}

function actionResponse(init: RequestInit | undefined): Response {
    const body = JSON.parse(String(init?.body)) as { chunks: RemoteBmp[] };

    return Response.json({ applied: body.chunks });
}

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('moving a file to Trash marks its chunks and keeps it out of Files without reloading', async () => {
    const unrelated = remoteChunk({
        fileHash: 'd'.repeat(64),
        fileId: 'd'.repeat(64),
        isLast: true,
        originalName: 'other.bin',
        folder: undefined,
        mediaKey: 'other'
    });
    const drive = driveWith([remoteChunk(), lastChunk(), unrelated]);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => actionResponse(init));
    const file = drive.library.files.find((item) => item.fileHash === FILE_HASH)!;

    await drive.actOnFile(file, FileActionKind.Delete);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(drive.library.files.map((item) => item.name)).toEqual(['other.bin']);
    expect(drive.library.trashFiles).toHaveLength(1);
    expect(drive.library.trashFiles[0]?.trashed).toBe(true);
    expect(drive.library.trashFiles[0]?.folder).toBe('Projects/2026');
    expect(drive.library.trashFiles[0]?.chunks.every((item) => item.trashed)).toBe(true);
});

test('restoring a file returns it to its original folder and identity', async () => {
    const drive = driveWith([remoteChunk({ trashed: true }), lastChunk({ trashed: true })]);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => actionResponse(init));
    const file = drive.library.trashFiles[0]!;

    await drive.actOnFile(file, FileActionKind.Restore);

    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(drive.library.trashFiles).toHaveLength(0);
    expect(drive.library.files).toHaveLength(1);
    expect(drive.library.files[0]).toMatchObject({
        fileHash: FILE_HASH,
        fileId: FILE_HASH,
        folder: 'Projects/2026',
        complete: true
    });
    expect(drive.library.files[0]?.chunks.some((item) => item.trashed)).toBe(false);
});

test('deleting forever removes confirmed chunks and does not reload', async () => {
    const drive = driveWith([remoteChunk({ trashed: true }), lastChunk({ trashed: true })]);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => actionResponse(init));

    await drive.actOnFile(drive.library.trashFiles[0]!, FileActionKind.DeleteForever);

    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(drive.library.chunks).toEqual([]);
    expect(drive.library.files).toEqual([]);
    expect(drive.library.trashFiles).toEqual([]);
});

test('permanent delete confirmation acts on the Trash copy', async () => {
    const drive = driveWith([remoteChunk({ trashed: true, isLast: true })]);
    let body: { action?: string } = {};
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        body = JSON.parse(String(init?.body)) as { action?: string };

        return actionResponse(init);
    });
    const file = drive.library.trashFiles[0]!;

    drive.requestDeleteForever(file);
    expect(drive.confirmPermanent).toBe(true);
    drive.confirmAction();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(drive.working).toBe(false));

    expect(body.action).toBe('delete-forever');
    expect(drive.library.trashFiles).toEqual([]);
});

test('restoring trashed siblings recovers a partial file in place', async () => {
    const drive = driveWith([remoteChunk({ trashed: true }), lastChunk()]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => actionResponse(init));
    const partial = drive.library.files[0]!;
    if (!partial.trashedChunks?.length) throw new Error('Expected trashed siblings');

    await drive.actOnFile({ ...partial, chunks: partial.trashedChunks }, FileActionKind.Restore);

    expect(drive.library.trashFiles).toHaveLength(0);
    expect(drive.library.files).toHaveLength(1);
    expect(drive.library.files[0]?.complete).toBe(true);
    expect(drive.library.files[0]?.chunks).toHaveLength(2);
});

test('a partial-trash file stays in Files and is not downloadable', () => {
    const drive = driveWith([remoteChunk({ trashed: true }), lastChunk()]);
    const partial = drive.library.files[0]!;

    expect(drive.library.trashFiles).toEqual([]);
    expect(partial.complete).toBe(false);
    expect(partial.chunks.map((item) => item.mediaKey)).toEqual(['last-chunk']);
    expect(partial.trashedChunks?.map((item) => item.mediaKey)).toEqual(['first-chunk']);
});
