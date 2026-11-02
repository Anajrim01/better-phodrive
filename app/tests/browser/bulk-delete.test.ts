import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import * as filesApi from '#browser/files';
import { FILE_CHANGED_MESSAGE } from '#browser/drive/file-snapshot';
import { chunk, failed, file, makeBulk, ok, ownerRoute } from './bulk-fixtures';

vi.mock('#browser/files', () => ({
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
    deleteForeverFile: vi.fn(),
    downloadFile: vi.fn(),
    restoreFile: vi.fn(),
    saveDownloadedFile: vi.fn()
}));

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(filesApi.saveDownloadedFile).mockReturnValue(Ok(undefined));
});

function deliver(
    files: readonly ReturnType<typeof file>[],
    onFile: Parameters<typeof filesApi.deleteFiles>[4],
    errors: Record<string, string> = {},
    action = FileActionKind.Delete
) {
    for (const item of files) {
        const error = errors[item.name];
        onFile(
            item,
            error
                ? { action, deleted: [], error }
                : { action, deleted: [...item.chunks, ...item.duplicates] }
        );
    }
}

test('bulk delete posts once per account and keeps failed files selected', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation((_email, _token, files, _workers, onFile) =>
        Ok(undefined).andThenAsync(async () => {
            deliver(files, onFile, { 'second.bin': 'Google Photos refused the request' });

            return Ok(undefined);
        })
    );
    const { bulk, selection, feedback, reloadGroup, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.delete([first, second]);

    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first@example.com',
        [first],
        2,
        expect.any(Function),
        FileActionKind.Delete
    );
    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second@example.com',
        [second],
        2,
        expect.any(Function),
        FileActionKind.Delete
    );
    expect([...selection.selectedKeys]).toEqual([fileKey(second)]);
    expect(reloadGroup).toHaveBeenCalledTimes(1);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining(
            '1 failure with "Google Photos refused the request" from second@example.com.'
        )
    );
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Examples: second.bin.'));
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Deleted 1 of 2 files.'));
});

test('files from one account share a single request', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    vi.mocked(filesApi.deleteFiles).mockImplementation((_email, _token, files, _workers, onFile) =>
        Ok(undefined).andThenAsync(async () => {
            deliver(files, onFile);

            return Ok(undefined);
        })
    );
    const { bulk, selection, setFiles } = makeBulk();
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.delete([first, second]);

    expect(filesApi.deleteFiles).toHaveBeenCalledOnce();
    expect(vi.mocked(filesApi.deleteFiles).mock.calls[0]?.[2]).toEqual([first, second]);
    expect(selection.size).toBe(0);
});

test('progress advances as each file completes inside an account request', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({ fileId: 'b'.repeat(64), name: 'second.bin' });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation((_email, _token, files, _workers, onFile) =>
        Ok(undefined).andThenAsync(async () => {
            onFile(files[0], { action: FileActionKind.Delete, deleted: [...files[0].chunks] });
            await gate;
            onFile(files[1], { action: FileActionKind.Delete, deleted: [...files[1].chunks] });

            return Ok(undefined);
        })
    );
    const { bulk, selection, setFiles } = makeBulk();
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    const pending = bulk.delete([first, second]);

    await vi.waitFor(() => expect(bulk.progressDone).toBe(1));
    expect(bulk.running).toBe(true);
    release();
    await pending;
    expect(bulk.progressDone).toBe(2);
    expect(bulk.running).toBe(false);
});

test('a partially trashed file keeps confirmed chunks and stays selected', async () => {
    const first = file({
        name: 'first.bin',
        chunks: [chunk({ mediaKey: 'media-0' }), chunk({ mediaKey: 'media-1', chunkIndex: 1 })]
    });
    const onTrashed = vi.fn();
    vi.mocked(filesApi.deleteFiles).mockImplementation((_email, _token, files, _workers, onFile) =>
        Ok(undefined).andThenAsync(async () => {
            onFile(files[0], {
                action: FileActionKind.Delete,
                deleted: [files[0].chunks[0]],
                error: 'One chunk failed'
            });

            return Ok(undefined);
        })
    );
    const { bulk, selection, feedback, setFiles } = makeBulk({ onTrashed });
    setFiles([first]);
    selection.selectAll([fileKey(first)]);

    await bulk.delete([first]);

    expect(onTrashed).toHaveBeenCalledWith(first, first.chunks[0]);
    expect([...selection.selectedKeys]).toEqual([fileKey(first)]);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('One chunk failed'));
});

test('bulk delete refuses a file that changed while confirming', async () => {
    const item = file({ name: 'first.bin' });
    const changed = file({
        name: 'first.bin',
        chunks: [chunk({ sha1: 'c'.repeat(40) })]
    });
    vi.mocked(filesApi.deleteFiles).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback, setFiles } = makeBulk();
    setFiles([changed]);
    selection.selectAll([fileKey(item)]);

    await bulk.delete([item]);

    expect(filesApi.deleteFiles).not.toHaveBeenCalled();
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

test('delete forever aborts when the confirmation sees a restored file', async () => {
    const snapshot = file({
        name: 'old.bin',
        trashed: true,
        chunks: [],
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const restored = file({
        name: 'old.bin',
        trashed: false,
        chunks: [chunk()],
        trashedChunks: []
    });
    vi.mocked(filesApi.deleteForeverFile).mockReturnValue(ok(undefined));
    const { bulk, selection, feedback, setFiles } = makeBulk();
    setFiles([restored]);
    selection.selectAll([fileKey(snapshot)]);

    await bulk.deleteForever([snapshot]);

    expect(filesApi.deleteForeverFile).not.toHaveBeenCalled();
    expect(feedback).toHaveBeenCalledWith(FILE_CHANGED_MESSAGE);
    expect([...selection.selectedKeys]).toEqual([fileKey(snapshot)]);
});

test('a paused owner is reported without calling its account', async () => {
    const first = file({ name: 'first.bin' });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin'
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation((_email, _token, files, _workers, onFile) =>
        Ok(undefined).andThenAsync(async () => {
            deliver(files, onFile);

            return Ok(undefined);
        })
    );
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

    expect(filesApi.deleteFiles).toHaveBeenCalledTimes(1);
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

    expect(filesApi.deleteFiles).not.toHaveBeenCalled();
    expect([...selection.selectedKeys]).toEqual([fileKey(other)]);
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('Select the connected account for this file')
    );
});
