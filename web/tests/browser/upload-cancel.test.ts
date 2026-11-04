import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { DriveController } from '#browser/drive/index.svelte';
import { useAccount } from '../helpers/drive';

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

test('cancelling an active upload aborts its request and leaves the job retryable', async () => {
    let aborted = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    aborted = true;
                    reject(new DOMException('Upload cancelled', 'AbortError'));
                });
            })
    );
    const drive = new DriveController('test@example.com');
    drive.initialize();
    useAccount(drive);

    const uploading = drive.upload([new File(['cancel me'], 'cancel.bin')]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(drive.busy).toBe(true);

    drive.cancelUploads();
    await uploading;

    expect(aborted).toBe(true);
    expect(drive.busy).toBe(false);
    expect(drive.uploadJobs[0]).toMatchObject({
        name: 'cancel.bin',
        status: UploadJobStatus.Error,
        message: 'Upload cancelled.'
    });
});
