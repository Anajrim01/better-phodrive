import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import type { ManageResponse } from '@madkarmaa/phodrive-core/manage';
import * as filesApi from '#browser/files';
import * as manageApi from '@madkarmaa/phodrive-core/browser/manage';
import { DriveBulk } from '#browser/drive/bulk.svelte';
import { DriveSelection } from '#browser/drive/selection.svelte';

vi.mock('#browser/files', () => ({
    deleteFile: vi.fn(),
    deleteForeverFile: vi.fn(),
    downloadFile: vi.fn(),
    restoreFile: vi.fn(),
    saveDownloadedFile: vi.fn()
}));

vi.mock('@madkarmaa/phodrive-core/browser/manage', () => ({
    moveFile: vi.fn()
}));

function chunk(overrides: Partial<UploadedChunk> = {}): UploadedChunk {
    return {
        email: 'first@example.com',
        fileHash: 'a'.repeat(64),
        fileId: 'a'.repeat(64),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        folder: '',
        size: 4,
        at: 1,
        mediaKey: 'media-0',
        sha1: 'b'.repeat(40),
        ...overrides
    };
}

function file(overrides: Partial<FileGroup> = {}): FileGroup {
    const id = overrides.fileId ?? 'a'.repeat(64);

    return {
        email: 'first@example.com',
        fileHash: id,
        fileId: id,
        name: 'proof.bin',
        folder: '',
        at: 1,
        chunkCount: 1,
        chunks: [chunk({ fileId: id, fileHash: id })],
        duplicates: [],
        trashedChunks: [],
        trashed: false,
        complete: true,
        ...overrides
    };
}

function ok<T>(value: T): AsyncResult<T, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

function failed<T = void>(message: string): AsyncResult<T, ApplicationError> {
    return Ok(undefined).andThenAsync(async () =>
        Err({ code: 'REQUEST_FAILED', message } as const)
    );
}

function manageResponse(): ManageResponse {
    return { items: [], revision: 3 };
}

type Deps = ConstructorParameters<typeof DriveBulk>[0];

function makeBulk(overrides: Partial<Deps> = {}) {
    const selection = new DriveSelection();
    const feedback = vi.fn();
    const applyItems = vi.fn();
    const reload = vi.fn();
    const reloadGroup = vi.fn();
    const closeUploads = vi.fn();
    let allFiles: FileGroup[] = [];
    const deps: Deps = {
        selection,
        account: () => ({ email: 'first@example.com', token: 'token-first' }),
        groupMode: () => false,
        routeMembers: () => [],
        workers: () => 2,
        onTrashed: vi.fn(),
        onRestored: vi.fn(),
        onRemoved: vi.fn(),
        allFiles: () => allFiles,
        busy: () => false,
        loading: () => false,
        applyItems,
        reload,
        reloadGroup,
        closeUploads,
        feedback,
        ...overrides
    };

    return {
        bulk: new DriveBulk(deps),
        selection,
        feedback,
        applyItems,
        reload,
        reloadGroup,
        closeUploads,
        setFiles(next: FileGroup[]) {
            allFiles = next;
        }
    };
}

const ownerRoute = (email: string) => ({
    email,
    token: `token-${email}`,
    paused: false
});

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(filesApi.saveDownloadedFile).mockReturnValue(Ok(undefined));
});

test('bulk delete routes each file to its owner and keeps failures selected', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    vi.mocked(filesApi.deleteFile)
        .mockReturnValueOnce(ok(undefined))
        .mockReturnValueOnce(failed('Google Photos refused the request'));
    const { bulk, selection, feedback, reloadGroup } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.delete([first, second]);

    expect(filesApi.deleteFile).toHaveBeenNthCalledWith(
        1,
        first,
        'token-first@example.com',
        expect.any(Function),
        2
    );
    expect(filesApi.deleteFile).toHaveBeenNthCalledWith(
        2,
        second,
        'token-second@example.com',
        expect.any(Function),
        2
    );
    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(reloadGroup).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('second@example.com: second.bin: Google Photos refused')
    );
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Deleted 1 of 2 files.'));
});

test('a paused owner is reported without calling its account', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    vi.mocked(filesApi.deleteFile).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [
            ownerRoute('first@example.com'),
            { ...ownerRoute('second@example.com'), paused: true }
        ]
    });
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.delete([first, second]);

    expect(filesApi.deleteFile).toHaveBeenCalledTimes(1);
    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('cannot be changed while that account is paused')
    );
});

test('bulk restore and delete forever use the existing per-file actions', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.restoreFile).mockReturnValue(ok(undefined));
    vi.mocked(filesApi.deleteForeverFile).mockReturnValue(ok(undefined));
    const { bulk, selection, reload } = makeBulk();
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.restore([first]);
    await bulk.deleteForever([second]);

    expect(filesApi.restoreFile).toHaveBeenCalledWith(first, 'token-first', expect.any(Function));
    expect(filesApi.deleteForeverFile).toHaveBeenCalledWith(
        second,
        'token-first',
        expect.any(Function),
        2
    );
    expect(selection.size).toBe(0);
    expect(reload).toHaveBeenCalledTimes(2);
});

test('bulk download streams one file at a time in the visible order', async () => {
    const first = file({ fileId: 'a'.repeat(64), name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    const third = file({ fileId: 'c'.repeat(64), name: 'third.bin' });
    let active = 0;
    let peak = 0;
    const order: string[] = [];
    vi.mocked(filesApi.downloadFile).mockImplementation((item) => {
        active++;
        peak = Math.max(peak, active);
        order.push(item.name);

        return Ok(undefined).andThenAsync(async () => {
            await Promise.resolve();
            active--;

            return Ok(new Blob([item.name]));
        });
    });
    const { bulk, selection, feedback } = makeBulk();
    selection.selectAll([fileKey(first), fileKey(second), fileKey(third)]);

    await bulk.download([first, second, third]);

    expect(order).toEqual(['first.bin', 'second.bin', 'third.bin']);
    expect(peak).toBe(1);
    expect(vi.mocked(filesApi.saveDownloadedFile).mock.calls.map((call) => call[1])).toEqual([
        'first.bin',
        'second.bin',
        'third.bin'
    ]);
    expect(selection.size).toBe(0);
    expect(feedback).toHaveBeenCalledWith('');
    expect(vi.mocked(filesApi.saveDownloadedFile).mock.calls[0]?.[0]).toBeInstanceOf(Blob);
});

test('a failed download stays selected and is reported', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    vi.mocked(filesApi.downloadFile)
        .mockReturnValueOnce(ok(new Blob(['first'])))
        .mockReturnValueOnce(failed('Download failed'));
    const { bulk, selection, feedback } = makeBulk();
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.download([first, second]);

    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Downloaded 1 of 2 files.'));
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('second.bin: Download failed'));
});

test('bulk move uses one destination, routes each owner and reports partial failures', async () => {
    const first = file({ name: 'first.bin', folder: '' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        folder: ''
    });
    vi.mocked(manageApi.moveFile)
        .mockReturnValueOnce(ok(manageResponse()))
        .mockReturnValueOnce(failed<ManageResponse>('No access'));
    const { bulk, selection, feedback, applyItems, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    bulk.openMove([first, second]);
    await bulk.move('Shared');

    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first@example.com',
        first.fileId,
        'Shared'
    );
    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second@example.com',
        second.fileId,
        'Shared'
    );
    expect(applyItems).toHaveBeenCalledWith('first@example.com', [], 3);
    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(bulk.moveOpen).toBe(false);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Moved 1 of 2 files.'));
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('No access'));
});

test('a move that fails for every file keeps the destination dialog open', async () => {
    const first = file({ name: 'first.bin' });
    vi.mocked(manageApi.moveFile).mockReturnValue(failed<ManageResponse>('No access'));
    const { bulk, selection } = makeBulk();
    selection.selectAll([fileKey(first)]);

    bulk.openMove([first]);
    await bulk.move('Shared');

    expect(bulk.moveOpen).toBe(true);
    expect(bulk.moveError).toContain('Could not move any files.');
    expect([...selection.selectedKeys]).toEqual([fileKey(first)]);
});

test('a file owned by another account is skipped without an API call', async () => {
    const other = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    const { bulk, selection, feedback } = makeBulk();
    selection.selectAll([fileKey(other)]);

    await bulk.delete([other]);

    expect(filesApi.deleteFile).not.toHaveBeenCalled();
    expect([...selection.selectedKeys]).toEqual([fileKey(other)]);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('Select the connected account for this file')
    );
});
