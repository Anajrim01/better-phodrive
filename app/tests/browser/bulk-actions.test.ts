import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import * as filesApi from '#browser/files';
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
    action: FileActionKind,
    files: readonly ReturnType<typeof file>[],
    onFile: Parameters<typeof filesApi.deleteFiles>[4],
    errors: Record<string, string> = {}
) {
    for (const item of files) {
        const error = errors[item.name];
        const affected =
            action === FileActionKind.Delete
                ? [...item.chunks, ...item.duplicates]
                : item.trashedChunks;
        onFile(item, error ? { action, deleted: [], error } : { action, deleted: affected });
    }
}

test('bulk restore and delete forever use the bulk endpoint', async () => {
    const first = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const second = file({
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                deliver(action, files, onFile);

                return Ok(undefined);
            })
    );
    const { bulk, selection, reload, setFiles } = makeBulk();
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.restore([first]);
    await bulk.deleteForever([second]);

    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first',
        [first],
        2,
        expect.any(Function),
        FileActionKind.Restore
    );
    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        2,
        'first@example.com',
        'token-first',
        [second],
        2,
        expect.any(Function),
        FileActionKind.DeleteForever
    );
    expect(filesApi.restoreFile).not.toHaveBeenCalled();
    expect(filesApi.deleteForeverFile).not.toHaveBeenCalled();
    expect(selection.size).toBe(0);
    expect(reload).toHaveBeenCalledTimes(2);
});

test('bulk restore updates restorable chunks and keeps a partially failed file selected', async () => {
    const item = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [
            chunk({ mediaKey: 'media-0', trashedAt: 1 }),
            chunk({ mediaKey: 'media-1', chunkIndex: 1, trashedAt: 1 })
        ]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                onFile(files[0], {
                    action,
                    deleted: [files[0].trashedChunks[0]],
                    error: 'One chunk failed'
                });

                return Ok(undefined);
            })
    );
    const onRestored = vi.fn();
    const { bulk, selection, feedback, setFiles } = makeBulk({ onRestored });
    setFiles([item]);
    selection.selectAll([fileKey(item)]);

    await bulk.restore([item]);

    expect(filesApi.deleteFiles).toHaveBeenCalledWith(
        'first@example.com',
        'token-first',
        [item],
        2,
        expect.any(Function),
        FileActionKind.Restore
    );
    expect(onRestored).toHaveBeenCalledWith(item, expect.objectContaining({ mediaKey: 'media-0' }));
    expect([...selection.selectedKeys]).toEqual([fileKey(item)]);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('One chunk failed'));
});

test('bulk delete forever removes confirmed chunks and keeps a partially failed file selected', async () => {
    const item = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [
            chunk({ mediaKey: 'media-0', trashedAt: 1 }),
            chunk({ mediaKey: 'media-1', chunkIndex: 1, trashedAt: 1 })
        ]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                onFile(files[0], {
                    action,
                    deleted: [files[0].trashedChunks[0]],
                    error: 'One chunk failed'
                });

                return Ok(undefined);
            })
    );
    const onRemoved = vi.fn();
    const { bulk, selection, feedback, setFiles } = makeBulk({ onRemoved });
    setFiles([item]);
    selection.selectAll([fileKey(item)]);

    await bulk.deleteForever([item]);

    expect(filesApi.deleteFiles).toHaveBeenCalledWith(
        'first@example.com',
        'token-first',
        [item],
        2,
        expect.any(Function),
        FileActionKind.DeleteForever
    );
    expect(onRemoved).toHaveBeenCalledWith(item, expect.objectContaining({ mediaKey: 'media-0' }));
    expect(selection.selectedKeys.has(fileKey(item))).toBe(true);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('One chunk failed'));
});

test('bulk restore groups files by account and batches each account once', async () => {
    const first = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                deliver(action, files, onFile);

                return Ok(undefined);
            })
    );
    const { bulk, selection, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.restore([first, second]);

    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first@example.com',
        [first],
        2,
        expect.any(Function),
        FileActionKind.Restore
    );
    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second@example.com',
        [second],
        2,
        expect.any(Function),
        FileActionKind.Restore
    );
    expect(selection.size).toBe(0);
});

test('bulk delete forever groups files by account and batches each account once', async () => {
    const first = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    const second = file({
        email: 'second@example.com',
        fileId: 'b'.repeat(64),
        name: 'second.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                deliver(action, files, onFile);

                return Ok(undefined);
            })
    );
    const { bulk, selection, setFiles } = makeBulk({
        groupMode: () => true,
        routeMembers: () => [ownerRoute('first@example.com'), ownerRoute('second@example.com')]
    });
    setFiles([first, second]);
    selection.selectAll([fileKey(first), fileKey(second)]);

    await bulk.deleteForever([first, second]);

    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        1,
        'first@example.com',
        'token-first@example.com',
        [first],
        2,
        expect.any(Function),
        FileActionKind.DeleteForever
    );
    expect(filesApi.deleteFiles).toHaveBeenNthCalledWith(
        2,
        'second@example.com',
        'token-second@example.com',
        [second],
        2,
        expect.any(Function),
        FileActionKind.DeleteForever
    );
    expect(selection.size).toBe(0);
});

test('a malformed permanent delete response leaves the file selected', async () => {
    const item = file({
        name: 'first.bin',
        trashed: true,
        trashedChunks: [chunk({ trashedAt: 1 })]
    });
    vi.mocked(filesApi.deleteFiles).mockImplementation(
        (_email, _token, files, _workers, onFile, action = FileActionKind.Delete) =>
            Ok(undefined).andThenAsync(async () => {
                onFile(files[0], {
                    action,
                    deleted: [],
                    error: 'Invalid delete response.'
                });

                return Ok(undefined);
            })
    );
    const onRemoved = vi.fn();
    const { bulk, selection, feedback, setFiles } = makeBulk({ onRemoved });
    setFiles([item]);
    selection.selectAll([fileKey(item)]);

    await bulk.deleteForever([item]);

    expect(onRemoved).not.toHaveBeenCalled();
    expect(selection.selectedKeys.has(fileKey(item))).toBe(true);
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Invalid delete response.'));
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
    expect(feedback).toHaveBeenCalledWith(
        expect.stringContaining('1 failure with "Download failed" from first@example.com.')
    );
    expect(feedback).toHaveBeenCalledWith(expect.stringContaining('Examples: second.bin.'));
});
