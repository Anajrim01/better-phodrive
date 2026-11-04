import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { ProcessingMode, UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import { SECOND_ACCOUNT, TEST_ACCOUNT, useGroup } from '../helpers/drive';
import { chunk } from '../helpers/files';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

const GROUP = {
    id: 'group',
    name: 'Group',
    members: [TEST_ACCOUNT, SECOND_ACCOUNT]
};

function file(name: string, size: number): File {
    return new File([new Uint8Array(size)], name);
}

function statusJobs(
    files: readonly File[],
    onJob: (job: UploadJob) => void,
    status = UploadJobStatus.Complete
) {
    for (const job of filesApi.createUploadJobs(files))
        onJob({
            ...job,
            status,
            message: status === UploadJobStatus.Error ? 'synthetic failure' : '',
            result: null
        });
}

function callsByAccount(calls: readonly (readonly unknown[])[]) {
    return new Map(
        calls.map((call) => {
            const accountId = call[6] as string;
            const files = call[0] as File[];

            return [accountId, files.map((item) => item.name)];
        })
    );
}

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('group uploads keep every file in one account queue and append locally', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            statusJobs(files, onJob);

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, GROUP);
    const load = vi.spyOn(drive.library, 'load');
    const refresh = vi.spyOn(drive.library, 'refresh');

    await drive.upload([file('a.bin', 100), file('b.bin', 100), file('c.bin', 10)]);

    const queues = callsByAccount(upload.mock.calls);
    expect(queues).toEqual(
        new Map([
            [TEST_ACCOUNT.id, ['a.bin', 'c.bin']],
            [SECOND_ACCOUNT.id, ['b.bin']]
        ])
    );
    expect(upload.mock.calls.every((call) => typeof call[6] === 'string')).toBe(true);
    expect(upload.mock.calls.every((call) => call[5] === ProcessingMode.Browser)).toBe(true);
    expect(upload.mock.calls.every((call) => call[2] === drive.settings.concurrentWorkers)).toBe(
        true
    );
    expect(upload.mock.calls.flatMap((call) => call[0] as File[])).toHaveLength(3);
    expect(
        new Set(upload.mock.calls.flatMap((call) => (call[0] as File[]).map((item) => item.name)))
    ).toEqual(new Set(['a.bin', 'b.bin', 'c.bin']));
    // Queue-level check: one dispatch per file; request routing is covered by owner-routing tests.
    const ownersByFile = new Map<string, Set<string>>();
    for (const call of upload.mock.calls) {
        const accountId = call[6] as string;
        for (const item of call[0] as File[]) {
            const owners = ownersByFile.get(item.name) ?? new Set<string>();
            owners.add(accountId);
            ownersByFile.set(item.name, owners);
        }
    }
    expect([...ownersByFile.values()].every((owners) => owners.size === 1)).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
});

test('group retry keeps the original owner after the context changes', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            statusJobs(files, onJob, UploadJobStatus.Error);

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, GROUP);

    await drive.upload([file('a.bin', 100), file('b.bin', 100), file('c.bin', 10)]);
    expect(upload).toHaveBeenCalledTimes(2);

    drive.context.current = { kind: 'account', account: TEST_ACCOUNT };
    await drive.retryUpload(1);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2][0]).toEqual([expect.objectContaining({ name: 'b.bin' })]);
    expect(upload.mock.calls[2][1]).toBe(SECOND_ACCOUNT.email);
    expect(upload.mock.calls[2][6]).toBe(SECOND_ACCOUNT.id);

    drive.context.accounts = [TEST_ACCOUNT];
    await drive.retryUpload(1);

    expect(upload).toHaveBeenCalledTimes(3);
    expect(drive.feedbackMessage).toContain('no longer connected');
});

test('group server-processing uploads keep one owner per whole file', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            statusJobs(files, onJob);

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com', undefined, ProcessingMode.Server);
    drive.initialize();
    useGroup(drive, GROUP);

    await drive.upload([file('a.bin', 100), file('b.bin', 100)]);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.every((call) => call[5] === ProcessingMode.Server)).toBe(true);
    expect(callsByAccount(upload.mock.calls)).toEqual(
        new Map([
            [TEST_ACCOUNT.id, ['a.bin']],
            [SECOND_ACCOUNT.id, ['b.bin']]
        ])
    );
});

test('an empty group refuses uploads with concise feedback', async () => {
    const upload = vi.spyOn(filesApi, 'uploadFiles');
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, { id: 'empty', name: 'Empty', members: [] });

    await drive.upload([file('proof.bin', 10)]);

    expect(drive.context.canUpload).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(drive.feedbackMessage).toBe('Add an account to this group before uploading.');
});

test('a one-member group sends every file through that member', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            statusJobs(files, onJob);

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, { id: 'group', name: 'Group', members: [TEST_ACCOUNT] });

    await drive.upload([file('a.bin', 100), file('b.bin', 10)]);

    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][0]).toEqual([
        expect.objectContaining({ name: 'a.bin' }),
        expect.objectContaining({ name: 'b.bin' })
    ]);
    expect(upload.mock.calls[0][6]).toBe(TEST_ACCOUNT.id);
});

test('a failed queue leaves successful chunks and the failed job retryable', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob, onChunk, _processing, accountId) => {
            if (accountId === SECOND_ACCOUNT.id) {
                statusJobs(files, onJob, UploadJobStatus.Error);
            } else {
                onChunk(
                    {
                        ...chunk(),
                        email: TEST_ACCOUNT.email,
                        accountId: TEST_ACCOUNT.id,
                        originalName: files[0]!.name,
                        size: files[0]!.size,
                        mediaKey: 'first-media',
                        sha1: 'c'.repeat(40)
                    },
                    0
                );
                statusJobs(files, onJob);
            }

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, GROUP);

    await drive.upload([file('a.bin', 100), file('b.bin', 100), file('c.bin', 10)]);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(drive.library.chunks).toHaveLength(1);
    expect(drive.library.chunks[0]?.accountId).toBe(TEST_ACCOUNT.id);
    expect(drive.uploadJobs.find((job) => job.name === 'b.bin')?.status).toBe(
        UploadJobStatus.Error
    );
    expect(drive.uploadJobs.find((job) => job.name === 'a.bin')?.status).toBe(
        UploadJobStatus.Complete
    );
    expect(drive.uploadJobs.find((job) => job.name === 'c.bin')?.status).toBe(
        UploadJobStatus.Complete
    );
});

test('member queues run in parallel while each queue keeps its own account', async () => {
    const gates = new Map<string, () => void>();
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob, _onChunk, _processing, accountId) =>
            Ok(undefined).andThenAsync(async () => {
                active++;
                peak = Math.max(peak, active);
                started.push(accountId!);
                await new Promise<void>((resolve) => gates.set(accountId!, resolve));
                active--;

                statusJobs(files, onJob);

                return Ok(undefined);
            })
        );
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useGroup(drive, GROUP);

    const running = drive.upload([file('a.bin', 100), file('b.bin', 100)]);
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(peak).toBe(2);
    gates.get(TEST_ACCOUNT.id)?.();
    gates.get(SECOND_ACCOUNT.id)?.();
    await running;

    expect(upload).toHaveBeenCalledTimes(2);
});
