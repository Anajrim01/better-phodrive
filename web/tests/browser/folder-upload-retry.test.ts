import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';
import { DriveController } from '#browser/drive/index.svelte';
import * as filesApi from '#browser/files';
import { TEST_ACCOUNT, useAccount } from '../helpers/drive';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

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

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test('retry keeps the resolved folder after the user navigates away', async () => {
    const upload = vi
        .spyOn(filesApi, 'uploadFiles')
        .mockImplementation((files, _email, _workers, onJob) => {
            statusJobs(files, onJob, UploadJobStatus.Error);

            return Ok(undefined).andThenAsync(async () => Ok(undefined));
        });
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useAccount(drive);
    drive.library.folder = 'Projects/2026';
    const file = new File(['folder retry'], 'a.ts');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Source/a.ts' });

    await drive.upload([file]);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][8]).toEqual(['Projects/2026/Source']);

    drive.library.folder = 'Photos';

    upload.mockImplementation((files, _email, _workers, onJob) => {
        statusJobs(files, onJob);

        return Ok(undefined).andThenAsync(async () => Ok(undefined));
    });
    await drive.retryUpload(0);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][6]).toBe(TEST_ACCOUNT.id);
    expect(upload.mock.calls[1][8]).toEqual(['Projects/2026/Source']);
    expect(drive.uploadJobs[0]?.status).toBe(UploadJobStatus.Complete);
});

test('malformed relative folders fail validation in root and non-root folders', async () => {
    const upload = vi.spyOn(filesApi, 'uploadFiles');
    const paths = [
        '/a.ts',
        'Source//a.ts',
        'Source//nested/a.ts',
        'Source/./a.ts',
        'Source/../a.ts',
        '../a.ts'
    ];

    for (const root of ['', 'Projects']) {
        for (const path of paths) {
            const drive = new DriveController('test@example.com');
            drive.initialize();
            useAccount(drive);
            drive.library.folder = root;
            const file = new File(['bad folder'], 'a.ts');
            Object.defineProperty(file, 'webkitRelativePath', { value: path });

            await drive.upload([file]);

            expect(upload).not.toHaveBeenCalled();
            expect(drive.uploadJobs[0]).toMatchObject({
                status: UploadJobStatus.Error,
                message: 'Invalid folder path.',
                retryable: false
            });
        }
    }
});
