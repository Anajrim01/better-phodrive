import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import * as filesApi from '#browser/files';
import { FILE_CHANGED_MESSAGE } from '#browser/drive/file-snapshot';
import { chunk, failed, file, makeBulk, ok, ownerRoute } from './bulk-fixtures';

vi.mock('#browser/files', () => ({
    deleteFile: vi.fn(),
    deleteForeverFile: vi.fn(),
    downloadFile: vi.fn(),
    restoreFile: vi.fn(),
    saveDownloadedFile: vi.fn()
}));

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
    const { bulk, selection, feedback, reloadGroup, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
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

test('bulk delete refuses a file that changed while confirming', async () => {
    const item = file({ name: 'first.bin' });
    const changed = file({
        name: 'first.bin',
        chunks: [chunk({ sha1: 'c'.repeat(40) })]
    });
    vi.mocked(filesApi.deleteFile).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback, setFiles } = makeBulk();
    setFiles([changed]);
    selection.selectAll([fileKey(item)]);

    await bulk.delete([item]);

    expect(filesApi.deleteFile).not.toHaveBeenCalled();
    expect(feedback).toHaveBeenCalledWith(FILE_CHANGED_MESSAGE);
    expect([...selection.selectedKeys]).toEqual([fileKey(item)]);
});

test('bulk delete forever refuses a file that changed while confirming', async () => {
    const item = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const changed = file({
        name: 'renamed.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.deleteForeverFile).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback, setFiles } = makeBulk();
    setFiles([changed]);
    selection.selectAll([fileKey(item)]);

    await bulk.deleteForever([item]);

    expect(filesApi.deleteForeverFile).not.toHaveBeenCalled();
    expect(feedback).toHaveBeenCalledWith(FILE_CHANGED_MESSAGE);
    expect([...selection.selectedKeys]).toEqual([fileKey(item)]);
});

test('a paused owner is reported without calling its account', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    vi.mocked(filesApi.deleteFile).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [
            ownerRoute('first@example.com'),
            { ...ownerRoute('second@example.com'), paused: true }
        ]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.delete([first, second]);

    expect(filesApi.deleteFile).toHaveBeenCalledTimes(1);
    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('cannot be changed while that account is paused')
    );
});

test('a file owned by another account is skipped without an API call', async () => {
    const other = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    const { bulk, selection, feedback, setFiles } = makeBulk();
    setFiles([other]);
    selection.selectAll([fileKey(other)]);

    await bulk.delete([other]);

    expect(filesApi.deleteFile).not.toHaveBeenCalled();
    expect([...selection.selectedKeys]).toEqual([fileKey(other)]);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('Select the connected account for this file')
    );
});
