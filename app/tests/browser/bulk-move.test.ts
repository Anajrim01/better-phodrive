import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import type { ManageResponse } from '@madkarmaa/phodrive-core/manage';
import * as manageApi from '@madkarmaa/phodrive-core/browser/manage';
import { fileKey, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import * as filesApi from '#browser/files';
import { applyManageItems } from '#browser/drive/apply-manage';
import { failed, file, makeBulk, manageResponse, ok, ownerRoute } from './bulk-fixtures';

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

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(filesApi.saveDownloadedFile).mockReturnValue(Ok(undefined));
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

test('a dragged multi-file move routes every file to its owner', async () => {
    const first = file({ name: 'first.bin', folder: 'Old' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        folder: 'Old'
    });
    vi.mocked(manageApi.moveFile).mockReturnValue(ok(manageResponse()));
    const { bulk, selection, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.moveTo([first, second], 'New');

    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first@example.com',
        first.fileId,
        'New'
    );
    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second@example.com',
        second.fileId,
        'New'
    );
    expect(selection.size).toBe(0);
    expect(bulk.moveOpen).toBe(false);
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

test('a cached no-op after a recovered move keeps the unseen change pending', async () => {
    const first = file({ name: 'first.bin', folder: 'Docs' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin', folder: 'Docs' });
    const revisions = new Map([['first@example.com', 5]]);
    const state = { chunks: [] as UploadedChunk[], revisions };
    vi.mocked(manageApi.moveFile)
        .mockReturnValueOnce(ok({ items: [], revision: 0 }))
        .mockReturnValueOnce(ok({ items: [], revision: 6 }));
    const { bulk, selection, setFiles } = makeBulk({
        applyItems: (email, items, revision) => applyManageItems(state, email, items, revision)
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    bulk.openMove([first, second]);
    await bulk.move('Docs');

    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first',
        first.fileId,
        'Docs'
    );
    expect(manageApi.moveFile).toHaveBeenNthCalledWith(
        2,
        'first@example.com',
        'token-first',
        second.fileId,
        'Docs'
    );
    expect(revisions.get('first@example.com')).toBe(5);
});
