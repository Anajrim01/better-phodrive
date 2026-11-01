import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup, FolderEntry, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { ManageResponse } from '@madkarmaa/phodrive-core/manage';
import * as manageApi from '@madkarmaa/phodrive-core/browser/manage';
import { applyManageItems } from '#browser/drive/apply-manage';
import { nextRevision } from '#browser/drive/manage-files';
import { DriveManage } from '#browser/drive/manage.svelte';

vi.mock('@madkarmaa/phodrive-core/browser/manage', () => ({
    deleteFolder: vi.fn(),
    moveFile: vi.fn(),
    moveFolder: vi.fn(),
    moveFolderContents: vi.fn(),
    renameFile: vi.fn(),
    renameFolder: vi.fn()
}));

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: 'A',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        name: 'proof.bin',
        folder: 'A',
        at: 1,
        chunkCount: 1,
        chunks: [chunk()],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

function response(overrides: Partial<ManageResponse> = {}): ManageResponse {
    return { items: [], revision: 7, ...overrides };
}

function ok(value: ManageResponse): AsyncResult<ManageResponse, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

function failed(message: string): AsyncResult<ManageResponse, ApplicationError> {
    return Ok(undefined).andThenAsync(async () =>
        Err({ code: 'REQUEST_FAILED', message } as const)
    );
}

type Deps = ConstructorParameters<typeof DriveManage>[0];

function makeManage(overrides: Partial<Deps> = {}) {
    const applyItems = vi.fn();
    const feedback = vi.fn();
    let files = [file()];
    const deps: Deps = {
        account: () => ({ email: 'first@example.com', token: 'token-first' }),
        groupMode: () => false,
        routeMembers: () => [],
        files: () => files,
        busy: () => false,
        loading: () => false,
        workers: () => 2,
        feedback,
        applyItems,
        openFolder: vi.fn(),
        currentFolder: () => '',
        ...overrides
    };
    const manage = new DriveManage(deps);

    return {
        manage,
        applyItems,
        feedback,
        setFiles(next: FileGroup[]) {
            files = next;
        },
        deps
    };
}

const folder: FolderEntry = { path: 'A', name: 'A', files: 1, subfolders: 0 };

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(manageApi.renameFile).mockReturnValue(ok(response()));
});

test('the revision cursor only advances when no other change can be skipped', () => {
    expect(nextRevision(4, 5)).toBe(5);
    expect(nextRevision(5, 5)).toBe(5);
    expect(nextRevision(4, 7)).toBeUndefined();
    expect(nextRevision(0, 8)).toBeUndefined();
    expect(nextRevision(9, 8)).toBeUndefined();
    expect(nextRevision(5, 0)).toBeUndefined();
});

test('a recovered response applies items without advancing the cursor', () => {
    const revisions = new Map([['first@example.com', 5]]);
    const state = { chunks: [] as UploadedChunk[], revisions };
    const recovered = chunk({ mediaKey: 'recovered', originalName: 'recovered.bin' });

    applyManageItems(state, 'first@example.com', [recovered], 0);

    expect(state.chunks.some((item) => item.mediaKey === 'recovered')).toBe(true);
    expect(state.revisions.get('first@example.com')).toBe(5);
});

test('a manage response without items leaves the cursor where it was', () => {
    const revisions = new Map([['first@example.com', 5]]);
    const state = { chunks: [] as UploadedChunk[], revisions };

    applyManageItems(state, 'first@example.com', [], 6);

    expect(state.revisions.get('first@example.com')).toBe(5);
});

test('renaming a file routes to the selected account and applies the response', async () => {
    const restored = file({ name: 'renamed.bin' });
    vi.mocked(manageApi.renameFile).mockReturnValue(
        ok(response({ items: [restored.chunks[0]!], revision: 9 }))
    );
    const { manage, applyItems } = makeManage();
    const item = file();

    manage.openRename({ kind: 'file', item });
    await manage.rename('renamed.bin');

    expect(manageApi.renameFile).toHaveBeenCalledWith(
        'first@example.com',
        'token-first',
        item.fileId,
        'renamed.bin'
    );
    expect(applyItems).toHaveBeenCalledWith('first@example.com', [restored.chunks[0]], 9);
    expect(manage.dialog).toBeNull();
});

test('a file on another account is not changed by the selected account', async () => {
    const { manage, feedback } = makeManage();
    const item = file({ email: 'second@example.com' });

    manage.openRename({ kind: 'file', item });
    await manage.rename('renamed.bin');

    expect(manageApi.renameFile).not.toHaveBeenCalled();
    expect(manage.dialogError).toContain('Switch to second@example.com');
    expect(feedback).not.toHaveBeenCalled();
});

test('group folder rename applies per owner and reports a partial failure', async () => {
    const first = file({ email: 'first@example.com' });
    const second = file({
        email: 'second@example.com',
        fileId: 'c'.repeat(64),
        fileHash: 'c'.repeat(64),
        chunks: [
            chunk({
                email: 'second@example.com',
                fileId: 'c'.repeat(64),
                fileHash: 'c'.repeat(64),
                mediaKey: 'second'
            })
        ]
    });
    vi.mocked(manageApi.renameFolder)
        .mockReturnValueOnce(ok(response({ items: [first.chunks[0]!], revision: 10 })))
        .mockReturnValueOnce(failed('That account is paused.'));
    const { manage, applyItems, setFiles } = makeManage({
        groupMode: () => true,
        routeMembers: () => [
            { email: 'first@example.com', token: 'token-first', paused: false },
            { email: 'second@example.com', token: 'token-second', paused: false }
        ]
    });
    setFiles([first, second]);

    manage.openRename({ kind: 'folder', entry: folder });
    await manage.rename('Renamed');

    expect(manageApi.renameFolder).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first',
        'A',
        'Renamed'
    );
    expect(manageApi.renameFolder).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second',
        'A',
        'Renamed'
    );
    expect(applyItems).toHaveBeenCalledTimes(1);
    expect(applyItems).toHaveBeenCalledWith('first@example.com', [first.chunks[0]], 10);
    expect(manage.dialogError).toContain('Changed 1 of 2 accounts');
    expect(manage.dialogError).toContain('second@example.com');
});

test('move destinations exclude the folder itself and its descendants', () => {
    const { manage, setFiles } = makeManage();
    setFiles([
        file({ folder: 'A' }),
        file({ fileId: 'c'.repeat(64), folder: 'A/sub' }),
        file({ fileId: 'd'.repeat(64), folder: 'B' })
    ]);

    manage.openMove({ kind: 'folder', entry: folder });

    expect(manage.moveValue).toBe('');
    expect(manage.moveDestinations.map((entry) => entry.value)).toEqual(['', 'B']);
});

test('a group folder only offers destinations every owner has', () => {
    const { manage, setFiles } = makeManage({
        groupMode: () => true,
        routeMembers: () => [
            { email: 'first@example.com', token: 'token-first', paused: false },
            { email: 'second@example.com', token: 'token-second', paused: false }
        ]
    });
    setFiles([
        file({ folder: 'A' }),
        file({ fileId: 'c'.repeat(64), folder: 'B' }),
        file({
            email: 'second@example.com',
            fileId: 'd'.repeat(64),
            folder: 'A',
            chunks: [
                chunk({
                    email: 'second@example.com',
                    fileId: 'd'.repeat(64),
                    fileHash: 'd'.repeat(64),
                    mediaKey: 'second'
                })
            ]
        }),
        file({
            email: 'second@example.com',
            fileId: 'e'.repeat(64),
            folder: 'C',
            chunks: [
                chunk({
                    email: 'second@example.com',
                    fileId: 'e'.repeat(64),
                    fileHash: 'e'.repeat(64),
                    mediaKey: 'second-c'
                })
            ]
        })
    ]);

    manage.openMove({ kind: 'folder', entry: folder });

    expect(manage.moveDestinations.map((entry) => entry.value)).toEqual(['']);
});

test('file move destinations include the current folder and My files', () => {
    const { manage, setFiles } = makeManage();
    setFiles([file({ folder: 'A' }), file({ fileId: 'c'.repeat(64), folder: 'B/sub' })]);

    manage.openMove({ kind: 'file', item: file() });

    expect(manage.moveValue).toBe('A');
    expect(manage.moveDestinations.map((entry) => entry.value)).toEqual(['', 'A', 'B', 'B/sub']);
});

test('folder delete reports the loaded file count', () => {
    const { manage, setFiles } = makeManage();
    setFiles([
        file({ folder: 'A' }),
        file({ fileId: 'c'.repeat(64), folder: 'A/sub' }),
        file({ fileId: 'd'.repeat(64), folder: 'B' })
    ]);

    manage.openFolderDelete(folder);

    expect(manage.folderFileCount).toBe(2);
    expect(manage.dialog).toBe('delete-folder');
});

test('a folder delete response with failed files keeps the dialog and explains why', async () => {
    vi.mocked(manageApi.deleteFolder).mockReturnValue(
        ok(
            response({
                fileCount: 2,
                failed: [
                    {
                        fileId: 'a'.repeat(64),
                        name: 'proof.bin',
                        message: 'Google Photos refused the request'
                    }
                ]
            })
        )
    );
    const { manage, applyItems } = makeManage();

    manage.openFolderDelete(folder);
    await manage.confirmDeleteFolder();

    expect(manageApi.deleteFolder).toHaveBeenCalledWith('first@example.com', 'token-first', 'A', 2);
    expect(applyItems).toHaveBeenCalled();
    expect(manage.dialog).toBe('delete-folder');
    expect(manage.dialogError).toContain('proof.bin: Google Photos refused the request');
});

test('moving folder contents reports partial failures without a dialog', async () => {
    vi.mocked(manageApi.moveFolderContents).mockReturnValue(failed('No access'));
    const { manage, feedback } = makeManage({
        groupMode: () => true,
        routeMembers: () => [{ email: 'first@example.com', token: 'token-first', paused: false }]
    });

    await manage.moveContents(folder);

    expect(feedback).toHaveBeenCalledWith('No access');
});
