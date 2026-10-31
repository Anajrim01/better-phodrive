import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadJobStatus, UploadPhase } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';
import { uploadGroupFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { DriveUploads } from '#browser/drive/uploads.svelte';

vi.mock('@madkarmaa/phodrive-core/browser/upload', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/upload')>();

    return { ...actual, uploadGroupFiles: vi.fn() };
});

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

test('retrying a failed group file stays on its owner and waits while paused', async () => {
    let secondPaused = false;
    const upload = vi.mocked(uploadGroupFiles);
    const feedback: string[] = [];

    upload.mockImplementationOnce((files, _members, _workers, onJob) => {
        const file = files[0]!;
        const job: UploadJob = {
            id: 0,
            name: file.name,
            status: UploadJobStatus.Error,
            progress: {
                phase: UploadPhase.Uploading,
                completed: 0,
                reused: 0,
                total: file.size
            },
            message: 'Upload failed',
            result: null,
            bytesPerSecond: 0,
            etaSeconds: null,
            retryAt: null,
            account: SECOND
        };
        onJob(job);

        return Ok(undefined).andThenAsync(async () => Ok({ waiting: 0 }));
    });
    upload.mockImplementation(() => Ok(undefined).andThenAsync(async () => Ok({ waiting: 0 })));

    const uploads = new DriveUploads({
        account: () => ({ email: FIRST, token: 'aas_et/first' }),
        group: () => ({
            members: [
                { email: FIRST, token: 'aas_et/first', paused: false },
                { email: SECOND, token: 'aas_et/second', paused: secondPaused }
            ]
        }),
        folder: () => '',
        workers: () => 1,
        loading: () => false,
        blocked: () => false,
        preferences: () => null,
        feedback: (message) => feedback.push(message),
        onChunk: () => {},
        afterUpload: () => {},
        reload: () => {},
        reloadGroup: () => {},
        markPaused: () => {},
        observe: () => {}
    });

    await uploads.upload([new File(['proof'], 'proof.bin')]);
    expect(uploads.jobs[0]?.status).toBe(UploadJobStatus.Error);

    secondPaused = true;
    await uploads.retry(0);

    expect(uploadGroupFiles).toHaveBeenCalledTimes(1);
    expect(uploads.jobs[0]).toMatchObject({
        status: UploadJobStatus.Queued,
        message: `Waiting for ${SECOND} to recover.`
    });

    secondPaused = false;
    await uploads.retry(0);

    expect(uploadGroupFiles).toHaveBeenCalledTimes(2);
    expect(vi.mocked(uploadGroupFiles).mock.calls[1]?.[1]).toEqual([
        { email: SECOND, token: 'aas_et/second', paused: false }
    ]);
    expect(feedback.some((message) => message.includes('no longer in this group'))).toBe(false);
});
