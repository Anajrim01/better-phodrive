import { expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { UploadJobStatus, UploadPhase } from '@madkarmaa/phodrive-core/models';
import { uploadGroupFiles } from '@madkarmaa/phodrive-core/browser/upload';
import { DriveUploads } from '#browser/drive/uploads.svelte';

vi.mock('@madkarmaa/phodrive-core/browser/upload', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@madkarmaa/phodrive-core/browser/upload')>();

    return { ...actual, uploadGroupFiles: vi.fn() };
});

const FIRST = 'first@example.com';
const SECOND = 'second@example.com';

test('a throttled group upload marks its owner paused', async () => {
    const markPaused = vi.fn();
    vi.mocked(uploadGroupFiles).mockImplementation((files, _members, _workers, onJob) => {
        const file = files[0]!;
        onJob({
            id: 0,
            name: file.name,
            status: UploadJobStatus.Active,
            progress: {
                phase: UploadPhase.Uploading,
                completed: 0,
                reused: 0,
                total: file.size
            },
            message: '',
            result: null,
            bytesPerSecond: 0,
            etaSeconds: null,
            retryAt: Date.now() + 30_000,
            account: FIRST
        });

        return Ok(undefined).andThenAsync(async () => Ok({ waiting: 0 }));
    });

    const uploads = new DriveUploads({
        account: () => ({ email: FIRST, token: 'aas_et/first' }),
        group: () => ({
            members: [
                { email: FIRST, token: 'aas_et/first', paused: false },
                { email: SECOND, token: 'aas_et/second', paused: false }
            ]
        }),
        folder: () => '',
        workers: () => 1,
        loading: () => false,
        blocked: () => false,
        preferences: () => null,
        feedback: () => {},
        onChunk: () => {},
        afterUpload: () => {},
        reload: () => {},
        reloadGroup: () => {},
        markPaused,
        observe: () => {}
    });

    await uploads.upload([new File(['x'], 'x.bin')]);

    expect(markPaused).toHaveBeenCalledWith(FIRST, expect.any(Number));
});
