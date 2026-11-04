import { UploadJobStatus, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { DriveController } from '#browser/drive/index.svelte';
import { SECOND_ACCOUNT, TEST_ACCOUNT, useAccount, useGroup } from '../helpers/drive';
import * as filesApi from '#browser/files';
import * as libraryApi from '@madkarmaa/phodrive-core/browser/library';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('retry keeps the original job ID and sends only its file, preserving other outcomes', async () => {
    const sources = [
        new File(['first'], 'complete.bin'),
        new File(['second'], 'failed-one.bin'),
        new File(['third'], 'failed-two.bin')
    ];
    let attempt = 0;
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            attempt++;

            for (const job of filesApi.createUploadJobs(files)) {
                const failed = attempt === 1 && job.id > 0;
                onJob({
                    ...job,
                    status: failed ? UploadJobStatus.Error : UploadJobStatus.Complete,
                    message: failed ? 'Upload start failed' : '',
                    result: failed
                        ? null
                        : {
                              status:
                                  attempt === 1
                                      ? UploadStatus.Uploaded
                                      : UploadStatus.AlreadyExists,
                              mediaKey: job.name,
                              sha1: '0'.repeat(40)
                          }
                });
            }

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useAccount(drive);

    await drive.upload(sources);
    const completed = drive.uploadJobs[0];
    const otherFailure = drive.uploadJobs[1];

    expect(drive.feedbackMessage).toBe('Upload start failed');
    drive.feedbackMessage = '';
    expect(drive.uploadJobs[1]).toEqual(otherFailure);
    expect(drive.uploadJobs[2].status).toBe(UploadJobStatus.Error);

    await drive.retryUpload(2);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0]).toEqual([sources[2]]);
    expect(drive.uploadJobs[0]).toEqual(completed);
    expect(drive.uploadJobs[1]).toEqual(otherFailure);
    expect(drive.uploadJobs[2]).toMatchObject({
        id: 2,
        name: sources[2].name,
        status: UploadJobStatus.Complete,
        message: '',
        result: { status: UploadStatus.AlreadyExists }
    });

    await drive.retryUpload(0);
    await drive.retryUpload(-1);
    drive.busy = true;
    await drive.retryUpload(1);
    drive.busy = false;
    drive.library.loading = true;
    await drive.retryUpload(1);

    expect(upload).toHaveBeenCalledTimes(2);
});

test('dismissing a library error preserves failed-load state and repeated errors can reappear', async () => {
    const failure = {
        code: 'REQUEST_FAILED',
        message: 'Library list failed (HTTP 400)'
    } as const;

    vi.spyOn(libraryApi, 'readLibraryPage').mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Err(failure))
    );
    vi.spyOn(libraryApi, 'readLibrarySnapshot')
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Err(failure)))
        .mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () => Ok({ items: [], nextPageToken: '', pages: 1 }))
        );

    const drive = new DriveController('test@example.com');
    drive.initialize();
    useAccount(drive);
    await drive.library.load();

    expect(drive.feedbackMessage).toBe(failure.message);
    expect(drive.library.loadFailed).toBe(true);

    drive.feedbackMessage = '';
    expect(drive.library.loadFailed).toBe(true);

    await drive.library.refresh();
    expect(drive.feedbackMessage).toBe(failure.message);
    expect(drive.library.loadFailed).toBe(true);

    drive.feedbackMessage = '';
    await drive.library.refresh();
    expect(drive.library.loadFailed).toBe(false);
    expect(drive.feedbackMessage).toBe('');
    expect(drive.library.chunks).toEqual([]);
});
test('selecting a group resolves its members and reloads the drive', async () => {
    const drive = new DriveController('test@example.com');
    drive.initialize();
    const group = { id: 'group', name: 'Group', members: [TEST_ACCOUNT, SECOND_ACCOUNT] };
    drive.context.accounts = [TEST_ACCOUNT, SECOND_ACCOUNT];
    drive.context.groups = [group];
    const load = vi.spyOn(drive.library, 'load').mockResolvedValue();

    await drive.selectContext({ kind: 'group', id: group.id });

    expect(drive.context.current).toEqual({ kind: 'group', group });
    expect(drive.library.chunks).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
});

test('a group context refuses new uploads and retry keeps the original account', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            for (const job of filesApi.createUploadJobs(files))
                onJob({
                    ...job,
                    status: UploadJobStatus.Error,
                    message: 'synthetic failure',
                    result: null
                });

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useAccount(drive);

    await drive.upload([new File(['first'], 'first.bin')]);
    expect(upload).toHaveBeenCalledOnce();

    const group = { id: 'group', name: 'Group', members: [TEST_ACCOUNT, SECOND_ACCOUNT] };
    useGroup(drive, group);
    await drive.upload([new File(['second'], 'second.bin')]);

    expect(upload).toHaveBeenCalledOnce();
    expect(drive.feedbackMessage).toBe('Select an individual account to upload.');

    await drive.retryUpload(0);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][1]).toBe(TEST_ACCOUNT.email);
    expect(upload.mock.calls[1][6]).toBe(TEST_ACCOUNT.id);
});
