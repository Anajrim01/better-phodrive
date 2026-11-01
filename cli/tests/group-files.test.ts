import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import {
    UploadJobStatus,
    UploadPhase,
    UploadStatus,
    type RemoteBmp
} from '@madkarmaa/phodrive-core/models';
import {
    deleteFile,
    downloadFile,
    readLibrary,
    uploadGroupFiles,
    type UploadJob
} from '@madkarmaa/phodrive-core/node';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearThrottleState,
    recordThrottle
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { writeConfig } from '../src/config';
import { runCli, temporaryFolder } from './helpers/cli';

vi.mock('@madkarmaa/phodrive-core/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/node')>();

    return {
        ...actual,
        uploadGroupFiles: vi.fn(),
        downloadFile: vi.fn(),
        deleteFile: vi.fn(),
        readLibrary: vi.fn()
    };
});

vi.mock('@madkarmaa/phodrive-core/server/photos', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/server/photos')>();

    return { ...actual, listBmps: vi.fn() };
});

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

let folder: Awaited<ReturnType<typeof temporaryFolder>>;

function remote(email: string, name: string, at = 1): RemoteBmp {
    const hash = createHash('sha256').update(`${email}:${name}`).digest('hex');

    return {
        fileHash: hash,
        fileId: hash,
        chunkIndex: 0,
        isLast: true,
        originalName: name,
        size: 4,
        at,
        mediaKey: `${email}:${name}`,
        sha1: createHash('sha1').update(name).digest('hex')
    };
}

function page(items: RemoteBmp[]) {
    const value = { items, nextPageToken: '', revision: 1 };

    return Ok(value).andThenAsync(async () => Ok(value));
}

beforeEach(async () => {
    folder = await temporaryFolder();
    await writeConfig(join(folder.path, 'config', 'config.json'), {
        accounts: { [FIRST]: 'aas_et/first', [SECOND]: 'aas_et/second' },
        selected: FIRST,
        settings: {},
        albums: {},
        groups: [{ id: 'family', name: 'Family', accounts: [FIRST, SECOND] }]
    });

    vi.mocked(listBmps).mockImplementation((email) =>
        page([remote(email, email === FIRST ? 'first.bin' : 'second.bin')])
    );
    vi.mocked(downloadFile).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(deleteFile).mockImplementation((item) => {
        const result = { deleted: item.chunks };

        return Ok(result).andThenAsync(async () => Ok(result));
    });
});

afterEach(async () => {
    vi.clearAllMocks();
    clearThrottleState();
    await folder.remove();
});

test('a group listing merges accounts, shows the owner, and adds it to JSON', async () => {
    const json = await runCli(['file', 'list', '--group', 'Family', '--json'], {
        folder: folder.path
    });

    expect(json.failures).toEqual([]);
    const files = JSON.parse(json.stdout) as { name: string; owner: string }[];
    expect(files.map(({ name, owner }) => [name, owner])).toEqual([
        ['first.bin', FIRST],
        ['second.bin', SECOND]
    ]);

    const table = await runCli(['file', 'list', '--group', 'Family'], { folder: folder.path });
    expect(table.stdout).toContain('Owner');
    expect(table.stdout).toContain(FIRST);
    expect(table.stdout).toContain(SECOND);
});

test('a paused member leaves a partial listing and does not block the other owner', async () => {
    vi.mocked(listBmps).mockImplementation((email) =>
        email === SECOND
            ? Err({
                  code: 'THROTTLED',
                  message: 'Google Photos is limiting requests',
                  retryAfterSeconds: 30
              } as const).andThenAsync(async () =>
                  Ok({ items: [], nextPageToken: '', revision: 1 })
              )
            : page([remote(FIRST, 'first.bin')])
    );

    const listed = await runCli(['file', 'list', '--group', 'Family', '--json'], {
        folder: folder.path
    });
    expect(JSON.parse(listed.stdout)).toHaveLength(1);
    expect(listed.stderr).toContain(SECOND);
    expect(listed.stderr).toContain('limiting');

    const downloaded = await runCli(
        ['file', 'download', 'first.bin', '--group', 'Family', '--output', 'first.bin'],
        { folder: folder.path }
    );
    expect(downloaded.failures).toEqual([]);
    expect(vi.mocked(downloadFile).mock.calls[0]?.[1]).toBe('aas_et/first');
});

test('a group upload sends the group members and their tokens', async () => {
    await writeFile(join(folder.path, 'proof.bin'), 'proof');
    let members: { email: string; token: string }[] = [];
    vi.mocked(uploadGroupFiles).mockImplementation((files, uploadMembers, _workers, onJob) => {
        members = uploadMembers.map(({ email, token }) => ({ email, token }));

        for (const [id, file] of files.entries()) {
            const job: UploadJob = {
                id,
                name: file.name,
                status: UploadJobStatus.Complete,
                progress: {
                    phase: UploadPhase.Uploading,
                    completed: file.size,
                    reused: 0,
                    total: file.size
                },
                message: '',
                result: {
                    status: UploadStatus.Uploaded,
                    mediaKey: `media-${id}`,
                    sha1: 'a'.repeat(40)
                },
                bytesPerSecond: 0,
                etaSeconds: null,
                retryAt: null
            };
            onJob(job);
        }

        return Ok(undefined).andThenAsync(async () => Ok({ waiting: 0 }));
    });

    const uploaded = await runCli(['file', 'upload', 'proof.bin', '--group', 'Family'], {
        folder: folder.path
    });

    expect(uploaded.failures).toEqual([]);
    expect(members).toEqual([
        { email: FIRST, token: 'aas_et/first' },
        { email: SECOND, token: 'aas_et/second' }
    ]);
});

test('a member already paused by the breaker starts paused', async () => {
    recordThrottle(SECOND, 60);
    await writeFile(join(folder.path, 'proof.bin'), 'proof');
    let members: { email: string; paused: boolean }[] = [];

    vi.mocked(uploadGroupFiles).mockImplementation((files, uploadMembers, _workers, onJob) => {
        members = uploadMembers.map(({ email, paused }) => ({ email, paused }));

        for (const [id, file] of files.entries()) {
            const job: UploadJob = {
                id,
                name: file.name,
                status: UploadJobStatus.Queued,
                progress: {
                    phase: UploadPhase.Receiving,
                    completed: 0,
                    total: file.size
                },
                message: 'Waiting for an available account.',
                result: null,
                bytesPerSecond: 0,
                etaSeconds: null,
                retryAt: null
            };
            onJob(job);
        }

        return Ok(undefined).andThenAsync(async () => Ok({ waiting: files.length }));
    });

    const uploaded = await runCli(['file', 'upload', 'proof.bin', '--group', 'Family'], {
        folder: folder.path
    });

    expect(uploaded.failures).toHaveLength(1);
    expect(uploaded.failures[0]).toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
    expect(uploaded.failures[0]?.message).toContain('no account was available');
    expect(members).toEqual([
        { email: FIRST, paused: false },
        { email: SECOND, paused: true }
    ]);
});

test('download and delete route a group file to its owner', async () => {
    const downloaded = await runCli(
        ['file', 'download', 'second.bin', '--group', 'Family', '--output', 'second.bin'],
        { folder: folder.path }
    );

    expect(downloaded.failures).toEqual([]);
    const [downloadedFile, downloadedToken] = vi.mocked(downloadFile).mock.calls[0] ?? [];
    expect(downloadedFile?.email).toBe(SECOND);
    expect(downloadedToken).toBe('aas_et/second');

    const deleted = await runCli(['file', 'delete', 'second.bin', '--group', 'Family', '--yes'], {
        folder: folder.path
    });

    expect(deleted.failures).toEqual([]);
    const [deletedFile, deletedToken] = vi.mocked(deleteFile).mock.calls[0] ?? [];
    expect(deletedFile?.email).toBe(SECOND);
    expect(deletedToken).toBe('aas_et/second');
});

test('file commands reject an unknown group', async () => {
    await writeFile(join(folder.path, 'proof.bin'), 'proof');

    for (const args of [
        ['file', 'list', '--group', 'Missing'],
        ['file', 'upload', 'proof.bin', '--group', 'Missing'],
        ['file', 'download', 'proof.bin', '--group', 'Missing'],
        ['file', 'delete', 'proof.bin', '--group', 'Missing', '--yes']
    ]) {
        const result = await runCli(args, { folder: folder.path });

        expect(result.failures[0]).toMatchObject({ code: 'GROUP_NOT_FOUND' });
    }
});

test('a listing without a group never queries group members', async () => {
    vi.mocked(readLibrary).mockImplementation(() => Ok(undefined).andThenAsync(async () => Ok([])));

    const listed = await runCli(['file', 'list'], { folder: folder.path });

    expect(listed.failures).toEqual([]);
    expect(vi.mocked(readLibrary)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listBmps)).not.toHaveBeenCalled();
});
