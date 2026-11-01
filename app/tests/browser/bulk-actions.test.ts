import { beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { fileKey } from '@madkarmaa/phodrive-core/files';
import * as filesApi from '#browser/files';
import { chunk, failed, file, makeBulk, ok } from './bulk-fixtures';

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
    const { bulk, selection, reload, setFiles } = makeBulk();
    setFiles([first, second]);
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
