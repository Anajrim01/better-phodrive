import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { downloadFile, readLibrary, uploadFiles } from '@madkarmaa/phodrive-core/node';
import { assignFolderAlbum } from '@madkarmaa/phodrive-core/server/photos';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { readConfig, writeConfig } from '../src/config';
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

vi.mock('@madkarmaa/phodrive-core/server/photos', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/server/photos')>();

    return { ...actual, assignFolderAlbum: vi.fn() };
});

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

beforeEach(async () => {
    folder = await temporaryFolder();
    await writeConfig(join(folder.path, 'config', 'config.json'), {
        accounts: { [EMAIL]: AAS_TOKEN },
        selected: EMAIL,
        settings: {},
        albums: {}
    });
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(assignFolderAlbum).mockImplementation((email, _token, album) =>
        Ok(`album-${email}-${album}`).andThenAsync(async (value) => Ok(value))
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

function chunk(file: File, id: number, folderPath: string): UploadedChunk {
    const fileId = id.toString(16).padStart(64, 'a');

    return {
        email: EMAIL,
        folder: folderPath || undefined,
        fileHash: fileId,
        fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: file.name,
        size: 10,
        at: 1,
        mediaKey: `key-${id}`,
        sha1: 'b'.repeat(40)
    };
}

function mockUpload(chunks: UploadedChunk[]): void {
    vi.mocked(uploadFiles).mockImplementation(
        (files, _email, _token, _workers, onJob, onChunk, options) =>
            Ok(undefined).andThenAsync(async () => {
                for (const [id, file] of files.entries()) {
                    const folderPath = options?.folders?.get(file) ?? '';
                    const saved = chunk(file, id, folderPath);
                    chunks.push(saved);
                    onChunk(saved);
                    onJob({
                        id,
                        name: file.name,
                        status: UploadJobStatus.Complete,
                        progress: {
                            phase: UploadPhase.Uploading,
                            completed: 1,
                            reused: 0,
                            total: 1
                        },
                        message: '',
                        result: {
                            status: UploadStatus.Uploaded,
                            mediaKey: saved.mediaKey,
                            sha1: saved.sha1
                        },
                        bytesPerSecond: 0,
                        etaSeconds: null,
                        retryAfterSeconds: null
                    });
                }

                return Ok(undefined);
            })
    );
}

test('listing can show every folder and the files in one folder', async () => {
    library([
        remoteFile('one.txt', 1, 1024, 'photos'),
        remoteFile('two.txt', 2, 2048, 'photos/2024'),
        remoteFile('three.txt', 3, 3072, 'trips')
    ]);

    const folders = await runCli(['file', 'list', '--folders', '--json'], {
        folder: folder.path
    });
    const shown = JSON.parse(folders.stdout);
    expect(shown).toEqual([
        { folder: 'photos', files: 1 },
        { folder: 'photos/2024', files: 1 },
        { folder: 'trips', files: 1 }
    ]);

    const children = await runCli(['file', 'list', '--folders', '--folder', 'photos', '--json'], {
        folder: folder.path
    });
    expect(JSON.parse(children.stdout)).toEqual([{ folder: 'photos/2024', files: 1 }]);

    const inside = await runCli(['file', 'list', '--folder', 'photos', '--json'], {
        folder: folder.path
    });
    expect(JSON.parse(inside.stdout).map((file: { name: string }) => file.name)).toEqual([
        'one.txt'
    ]);

    const root = await runCli(['file', 'list', '--folder', '.', '--json'], {
        folder: folder.path
    });
    expect(JSON.parse(root.stdout)).toEqual([]);
});

test('downloads keep the folder path and resolve same names in different folders', async () => {
    library([
        remoteFile('same.txt', 1, 1024, 'photos/a'),
        remoteFile('same.txt', 2, 1024, 'photos/b')
    ]);

    const downloaded = await runCli(
        ['file', 'download', 'photos/a/same.txt', 'photos/b/same.txt'],
        { folder: folder.path }
    );

    expect(downloaded.exitCode).toBe(0);
    expect(vi.mocked(downloadFile).mock.calls.map((call) => call[2])).toEqual([
        join(folder.path, 'photos', 'a', 'same.txt'),
        join(folder.path, 'photos', 'b', 'same.txt')
    ]);
});

test('nested downloads create their parent folders', async () => {
    library([remoteFile('same.txt', 1, 1024, 'photos/a')]);
    vi.mocked(downloadFile).mockImplementation((_file, _token, destination) =>
        Ok(undefined).andThenAsync(async () => {
            await writeFile(destination, 'content');

            return Ok(undefined);
        })
    );

    const downloaded = await runCli(['file', 'download', 'photos/a/same.txt'], {
        folder: folder.path
    });

    expect(downloaded.exitCode).toBe(0);
    expect(await readFile(join(folder.path, 'photos', 'a', 'same.txt'), 'utf8')).toBe('content');
});

test('a plain name that exists in two folders asks for the full path', async () => {
    library([
        remoteFile('same.txt', 1, 1024, 'photos/a'),
        remoteFile('same.txt', 2, 1024, 'photos/b')
    ]);

    const downloaded = await runCli(['file', 'download', 'same.txt'], { folder: folder.path });

    expect(downloaded.failures).toMatchObject([{ code: 'AMBIGUOUS_FILE' }]);
    expect(downloaded.stderr).toContain('photos/a/same.txt');
    expect(downloaded.stderr).toContain('photos/b/same.txt');
});

test('uploads keep folder paths and create one album per folder', async () => {
    await mkdir(join(folder.path, 'photos', 'nested'), { recursive: true });
    await writeFile(join(folder.path, 'photos', 'one.txt'), 'one');
    await writeFile(join(folder.path, 'photos', 'nested', 'two.txt'), 'two');
    const chunks: UploadedChunk[] = [];
    mockUpload(chunks);

    const uploaded = await runCli(['file', 'upload', 'photos'], { folder: folder.path });

    expect(uploaded.exitCode).toBe(0);
    const [files, , , , , , options] = vi.mocked(uploadFiles).mock.calls[0];
    expect(files.map((file) => file.name).sort()).toEqual(['one.txt', 'two.txt']);
    const folders = options?.folders;
    if (!folders) throw new Error('Expected upload folders.');
    expect([...folders.values()].sort()).toEqual(['photos', 'photos/nested']);
    expect(
        vi
            .mocked(assignFolderAlbum)
            .mock.calls.map((call) => call[2])
            .sort()
    ).toEqual(['photos', 'photos/nested']);

    const saved = (await readConfig(uploaded.configPath)).unwrap();
    expect(Object.keys(saved.albums[EMAIL] ?? {}).sort()).toEqual(['photos', 'photos/nested']);
});

test('an album failure does not fail the upload', async () => {
    await mkdir(join(folder.path, 'photos'), { recursive: true });
    await writeFile(join(folder.path, 'photos', 'one.txt'), 'one');
    mockUpload([]);
    const failure: ServerError = {
        code: 'REQUEST_FAILED',
        message: 'Google rejected the album.'
    };
    vi.mocked(assignFolderAlbum).mockImplementation(() =>
        Err(failure).andThenAsync(async () => Ok(''))
    );

    const uploaded = await runCli(['file', 'upload', 'photos'], { folder: folder.path });

    expect(uploaded.exitCode).toBe(0);
    expect(uploaded.stderr).toContain('Google rejected the album.');
});

test('a throttled listing prints the pause and retries', async () => {
    let attempts = 0;
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            attempts++;
            if (attempts === 1)
                return Err({
                    code: 'THROTTLED',
                    message: 'Google is throttling requests.',
                    retryAfterSeconds: 1
                } as const);

            return Ok([remoteFile('one.txt', 1, 1024, 'photos')]);
        })
    );

    const listed = await runCli(['file', 'list', '--json'], { folder: folder.path });

    expect(listed.exitCode).toBe(0);
    expect(listed.stderr).toContain('Google is throttling requests. Retrying in about 1 s.');
    expect(JSON.parse(listed.stdout)).toHaveLength(1);
    expect(attempts).toBe(2);
});

test('a throttled listing keeps retrying beyond three attempts', async () => {
    let attempts = 0;
    vi.mocked(readLibrary).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            attempts++;
            if (attempts <= 4)
                return Err({
                    code: 'THROTTLED',
                    message: 'Google is throttling requests.',
                    retryAfterSeconds: 1
                } as const);

            return Ok([remoteFile('one.txt', 1, 1024, 'photos')]);
        })
    );

    const listed = await runCli(['file', 'list', '--json'], { folder: folder.path });

    expect(listed.exitCode).toBe(0);
    expect(attempts).toBe(5);
    expect(JSON.parse(listed.stdout)).toHaveLength(1);
});
