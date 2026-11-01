import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileActionKind, ThemeMode, type RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { DriveController } from '#browser/drive/index.svelte';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => {
            values.delete(key);
        },
        setItem: (key, value) => {
            values.set(key, value);
        }
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@madkarmaa/phodrive-core/browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
    storage.clear();
    storage.setItem('accounts', JSON.stringify({ 'owner@example.com': 'aas_et/synthetic' }));
});

function remoteChunk(overrides: Partial<RemoteBmp> = {}): RemoteBmp {
    return {
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'archive.bin',
        size: 5,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        trashedAt: 1,
        ...overrides
    };
}

function driveWithChunks(chunks: RemoteBmp[]): DriveController {
    const drive = new DriveController();
    drive.initialize();
    drive.library.chunks = chunks.map((chunk) => ({ ...chunk, email: 'owner@example.com' }));

    return drive;
}

test('restore returns a fully trashed file to the main list', async () => {
    const trashed = remoteChunk();
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
            Response.json({ restored: [{ ...trashed, trashedAt: undefined }] })
        );
    const drive = driveWithChunks([trashed]);
    const item = drive.library.trashFiles[0];
    if (!item) throw new Error('Expected a trashed file.');

    await drive.actOnFile(item, FileActionKind.Restore);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        action: string;
        chunks: { mediaKey: string }[];
    };
    expect(body.action).toBe('restore');
    expect(body.chunks.map((chunk) => chunk.mediaKey)).toEqual(['media-0']);
    expect(drive.library.trashFiles).toEqual([]);
    expect(drive.library.files).toHaveLength(1);
    expect(drive.library.files[0]?.trashedChunks).toEqual([]);
});

test('delete forever removes the trashed chunks from the library', async () => {
    const trashed = remoteChunk();
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () => Response.json({ deleted: [trashed] }));
    const drive = driveWithChunks([trashed]);
    const item = drive.library.trashFiles[0];
    if (!item) throw new Error('Expected a trashed file.');

    await drive.actOnFile(item, FileActionKind.DeleteForever);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        action: string;
        chunks: { mediaKey: string }[];
    };
    expect(body.action).toBe('delete-forever');
    expect(body.chunks.map((chunk) => chunk.mediaKey)).toEqual(['media-0']);
    expect(drive.library.chunks).toEqual([]);
    expect(drive.library.trashFiles).toEqual([]);
});
