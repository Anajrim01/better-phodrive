import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { deleteFile, downloadFile, readLibrary, uploadFiles } from '@madkarmaa/phodrive-core/node';
import { writeConfig } from '../src/config';
import { AAS_TOKEN, EMAIL, remoteFile, runCli, temporaryFolder } from './helpers/cli';

vi.mock('@madkarmaa/phodrive-core/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/node')>();

    return {
        ...actual,
        readLibrary: vi.fn(),
        uploadFiles: vi.fn(),
        downloadFile: vi.fn(),
        deleteFile: vi.fn()
    };
});

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
    await writeConfig(join(folder.path, 'config', 'config.json'), {
        accounts: { [EMAIL]: AAS_TOKEN },
        selected: EMAIL,
        settings: {},
        albums: {},
        groups: []
    });
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    vi.clearAllMocks();
    await folder.remove();
});

function library(files: FileGroup[]) {
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(files))
    );
}

test('files are filtered, sorted, and printed as JSON without credentials', async () => {
    const report = remoteFile('report.pdf', 3);
    const notes = remoteFile('notes.txt', 2);
    const archive = remoteFile('archive.pdf', 1);
    library([report, notes, archive]);

    const listed = await runCli(['file', 'list', '--type', 'pdf', '--sort', 'name-asc', '--json'], {
        folder: folder.path
    });

    expect(readLibrary).toHaveBeenCalledWith(EMAIL, AAS_TOKEN);
    const files = JSON.parse(listed.stdout);
    expect(files.map((file: { name: string }) => file.name)).toEqual(['archive.pdf', 'report.pdf']);
    expect(files[0]).toMatchObject({ id: archive.fileId, type: 'PDF', size: 1024, complete: true });
    expect(listed.stdout).not.toContain('aas_et');
});

test('JSON output at a terminal prints only the JSON', async () => {
    library([remoteFile('report.pdf')]);

    const listed = await runCli(['file', 'list', '--json'], {
        folder: folder.path,
        interactive: true
    });

    expect(JSON.parse(listed.stdout)).toHaveLength(1);
    expect(listed.stderr).toBe('');
});

test('the saved sort order and search text apply to the table', async () => {
    library([remoteFile('b-report.pdf', 1), remoteFile('a-report.pdf', 2), remoteFile('other', 3)]);
    await runCli(['setting', 'set', 'sort', 'name-desc'], { folder: folder.path });

    const listed = await runCli(['file', 'list', 'report'], { folder: folder.path });

    const lines = listed.stdout.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('b-report.pdf');
    expect(lines[2]).toContain('a-report.pdf');
});

test('invalid filters fail before Google is contacted', async () => {
    const listed = await runCli(['file', 'list', '--days', '0'], { folder: folder.path });

    expect(listed.failures).toMatchObject([{ code: 'INVALID_OPTION' }]);
    expect(readLibrary).not.toHaveBeenCalled();
});

test('downloads resolve names and ID prefixes into the working folder', async () => {
    const report = remoteFile('report.pdf');
    const notes = remoteFile('notes.txt');
    library([report, notes]);

    const downloaded = await runCli(['file', 'download', 'report.pdf', notes.fileId.slice(0, 8)], {
        folder: folder.path
    });

    expect(downloaded.exitCode).toBe(0);
    expect(vi.mocked(downloadFile).mock.calls.map((call) => [call[0].name, call[2]])).toEqual([
        ['report.pdf', join(folder.path, 'report.pdf')],
        ['notes.txt', join(folder.path, 'notes.txt')]
    ]);
});

test('one download can be saved under a new file name', async () => {
    library([remoteFile('report.pdf')]);

    await runCli(['file', 'download', 'report.pdf', '--output', 'saved/copy.pdf', '--force'], {
        folder: folder.path
    });

    const [call] = vi.mocked(downloadFile).mock.calls;
    expect(call[2]).toBe(join(folder.path, 'saved', 'copy.pdf'));
    expect(call[3]).toMatchObject({ force: true });
});

test('ambiguous names list the matching IDs without a terminal', async () => {
    const first = remoteFile('same.txt');
    const second = remoteFile('same.txt');
    library([first, second]);

    const downloaded = await runCli(['file', 'download', 'same.txt'], { folder: folder.path });

    expect(downloaded.failures).toMatchObject([{ code: 'AMBIGUOUS_FILE' }]);
    expect(downloaded.stderr).toContain(first.fileId.slice(0, 12));
    expect(downloaded.stderr).toContain(second.fileId.slice(0, 12));
    expect(downloadFile).not.toHaveBeenCalled();
});

test('unknown files and existing destinations are reported', async () => {
    library([remoteFile('report.pdf')]);
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'FILE_EXISTS', message: 'report.pdf already exists.' } as const)
        )
    );

    const missing = await runCli(['file', 'download', 'nothing'], { folder: folder.path });
    const existing = await runCli(['file', 'download', 'report.pdf'], { folder: folder.path });

    expect(missing.failures).toMatchObject([{ code: 'FILE_NOT_FOUND' }]);
    expect(existing.exitCode).toBe(1);
    expect(existing.stderr).toContain('Pass --force to replace it.');
});

test('uploads expand folders and fail when any file fails', async () => {
    await mkdir(join(folder.path, 'photos', 'nested'), { recursive: true });
    await writeFile(join(folder.path, 'photos', 'one.txt'), 'one');
    await writeFile(join(folder.path, 'photos', 'nested', 'two.txt'), 'two');
    vi.mocked(uploadFiles).mockImplementation((files, _email, _token, _workers, onJob) =>
        Ok(undefined).andThenAsync(async () => {
            for (const [id, file] of files.entries())
                onJob({
                    id,
                    name: file.name,
                    status: id === 0 ? UploadJobStatus.Complete : UploadJobStatus.Error,
                    progress: { phase: UploadPhase.Uploading, completed: 1, reused: 0, total: 1 },
                    message: id === 0 ? '' : 'Commit rejected',
                    bytesPerSecond: 0,
                    etaSeconds: null,
                    retryAt: null,
                    result:
                        id === 0
                            ? {
                                  status: UploadStatus.Uploaded,
                                  mediaKey: 'key',
                                  sha1: 'a'.repeat(40)
                              }
                            : null
                });

            return Ok(undefined);
        })
    );

    const uploaded = await runCli(['file', 'upload', 'photos', '--workers', '3'], {
        folder: folder.path
    });

    const [files, , , workers] = vi.mocked(uploadFiles).mock.calls[0];
    expect(files.map((file) => file.name).sort()).toEqual(['one.txt', 'two.txt']);
    expect(workers).toBe(3);
    expect(uploaded.failures).toMatchObject([{ code: 'UPLOAD_INCOMPLETE' }]);
    expect(uploaded.stderr).toContain('Commit rejected');
});

test('empty folders have nothing to upload', async () => {
    await mkdir(join(folder.path, 'empty'));

    const uploaded = await runCli(['file', 'upload', 'empty'], { folder: folder.path });

    expect(uploaded.failures).toMatchObject([{ code: 'NO_FILES_SELECTED' }]);
    expect(uploadFiles).not.toHaveBeenCalled();
});

test('trash moves need confirmation and report partially moved files', async () => {
    const report = remoteFile('report.pdf');
    library([report]);
    vi.mocked(deleteFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok({ deleted: [], error: 'Request failed' }))
    );

    const unconfirmed = await runCli(['file', 'delete', 'report.pdf'], { folder: folder.path });
    expect(unconfirmed.failures).toMatchObject([{ code: 'INPUT_REQUIRED' }]);
    expect(readLibrary).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();

    const deleted = await runCli(['file', 'delete', 'report.pdf', '--yes'], {
        folder: folder.path
    });
    expect(deleteFile).toHaveBeenCalledWith(report, AAS_TOKEN, 8);
    expect(deleted.failures).toMatchObject([{ code: 'DELETE_INCOMPLETE' }]);
    expect(deleted.stderr).toContain('moved 0 of 1 chunks to trash. Request failed');
});

test('file commands require a connected account', async () => {
    const otherFolder = await temporaryFolder();

    const listed = await runCli(['file', 'list'], { folder: otherFolder.path });

    expect(listed.failures).toMatchObject([{ code: 'ACCOUNT_REQUIRED' }]);
    await otherFolder.remove();
});

test('rejected tokens suggest connecting the account again', async () => {
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Authentication failed (HTTP 403)' } as const)
        )
    );

    const listed = await runCli(['file', 'list'], { folder: folder.path });

    expect(listed.stderr).toContain('run `phodrive account add` again');
});

test('a paused delete retries the remaining chunks', async () => {
    const report = remoteFile('report.pdf');
    const first = report.chunks[0];
    const twoChunks = {
        ...report,
        chunks: [
            first,
            {
                ...first,
                chunkIndex: 1,
                isLast: true,
                mediaKey: 'media-second',
                sha1: 'b'.repeat(40)
            }
        ]
    };
    library([twoChunks]);
    let calls = 0;
    vi.mocked(deleteFile).mockImplementation((file) =>
        Ok(undefined).andThenAsync(async () => {
            calls++;

            return calls === 1
                ? Ok({ deleted: [file.chunks[0]], retryAfterSeconds: 1 })
                : Ok({ deleted: file.chunks });
        })
    );

    const deleted = await runCli(['file', 'delete', 'report.pdf', '--yes'], {
        folder: folder.path
    });

    expect(deleted.exitCode).toBe(0);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deleteFile).mock.calls[0][0].chunks).toHaveLength(2);
    expect(vi.mocked(deleteFile).mock.calls[1][0].chunks).toHaveLength(1);
    expect(deleted.stderr).toContain('Google Photos is limiting requests, retrying in about 1 s');
});

test('a delete that stays paused fails without a final wait', async () => {
    const report = remoteFile('report.pdf');
    library([report]);
    vi.mocked(deleteFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok({ deleted: [], retryAfterSeconds: 1 }))
    );
    const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler) => {
        if (typeof handler === 'function') handler();

        return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const deleted = await runCli(['file', 'delete', 'report.pdf', '--yes'], {
        folder: folder.path
    });

    timer.mockRestore();

    expect(deleteFile).toHaveBeenCalledTimes(8);
    expect(
        (deleted.stderr.match(/Google Photos is limiting requests, retrying/g) ?? []).length
    ).toBe(7);
    expect(deleted.stderr).toContain('try again');
    expect(deleted.failures).toMatchObject([{ code: 'DELETE_INCOMPLETE' }]);
});
