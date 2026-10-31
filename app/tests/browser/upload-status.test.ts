import { expect, test } from 'vitest';
import { createUploadJobs, type UploadJob } from '#browser/files';
import { uploadJobDetail } from '#browser/upload-status';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';

function job(overrides: Partial<UploadJob> = {}): UploadJob {
    const [created] = createUploadJobs([new File(['status'], 'status.bin')]);
    if (!created) throw new Error('Expected a job.');

    return { ...created, ...overrides };
}

test('a paused upload shows the throttle state and the remaining wait', () => {
    const detail = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            retryAfterSeconds: 120,
            progress: { phase: UploadPhase.Uploading, completed: 5, reused: 0, total: 10 }
        })
    );

    expect(detail).toBe('Paused at 50%. Retrying in about 2 min.');
});

test('an active upload appends the estimate only when one exists', () => {
    const withEstimate = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            etaSeconds: 80,
            progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
        })
    );
    const withoutEstimate = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
        })
    );

    expect(withEstimate).toBe('Uploading. 50% · about 1 min 20 s left');
    expect(withoutEstimate).toBe('Uploading. 50%');
});

test('completed and deduplicated uploads keep their existing wording', () => {
    const uploaded = uploadJobDetail(
        job({
            status: UploadJobStatus.Complete,
            result: { status: UploadStatus.Uploaded, mediaKey: 'key', sha1: 'a'.repeat(40) }
        })
    );
    const existing = uploadJobDetail(
        job({
            status: UploadJobStatus.Complete,
            result: { status: UploadStatus.AlreadyExists, mediaKey: 'key', sha1: 'a'.repeat(40) }
        })
    );

    expect(uploaded).toBe('Uploaded successfully');
    expect(existing).toBe('Already in Google Photos');
});
