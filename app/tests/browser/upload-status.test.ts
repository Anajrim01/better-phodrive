import { expect, test } from 'vitest';
import { createUploadJobs, type UploadJob } from '#browser/files';
import {
    ETA_STALE_MS,
    retryRemainingSeconds,
    uploadJobDetail,
    uploadPercent,
    uploadRate
} from '#browser/upload-status';
import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';

function job(overrides: Partial<UploadJob> = {}): UploadJob {
    const [created] = createUploadJobs([new File(['status'], 'status.bin')]);
    if (!created) throw new Error('Expected a job.');

    return { ...created, ...overrides };
}

test('a paused upload shows the throttle state and the remaining wait', () => {
    const now = Date.now();
    const detail = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            retryAt: now + 120_000,
            progress: { phase: UploadPhase.Uploading, completed: 5, reused: 0, total: 10 }
        }),
        now
    );

    expect(detail).toBe('Paused at 50%, retrying in about 2 min');
});

test('an active upload appends a measured estimate or names the uncertainty', () => {
    const now = Date.now();
    const withEstimate = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            etaSeconds: 80,
            etaUpdatedAt: now,
            progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
        }),
        now
    );
    const withoutEstimate = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
        }),
        now
    );

    expect(withEstimate).toBe('Uploading 50%, about 1 min 20 s left');
    expect(withoutEstimate).toBe('Uploading 50%, estimating...');
});

test('a sub-second estimate never reads as zero seconds left', () => {
    const now = Date.now();
    const detail = uploadJobDetail(
        job({
            status: UploadJobStatus.Active,
            etaSeconds: 0.2,
            etaUpdatedAt: now,
            progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
        }),
        now
    );

    expect(detail).toBe('Uploading 50%, about 1 s left');
});

test('an unfinished multi-chunk upload never rounds up to 100 percent', () => {
    const total = 318_000_000;
    const completed = Math.round(total * 0.996);
    const now = Date.now();
    const pending = job({
        status: UploadJobStatus.Active,
        etaSeconds: 2,
        etaUpdatedAt: now,
        progress: { phase: UploadPhase.Uploading, completed, reused: 0, total }
    });

    expect(uploadPercent(pending)).toBe(99);
    expect(uploadJobDetail(pending, now)).toBe('Uploading 99%, about 2 s left');

    const finished = job({
        status: UploadJobStatus.Active,
        progress: { phase: UploadPhase.Uploading, completed: total, reused: 0, total }
    });
    expect(uploadPercent(finished)).toBe(100);
    expect(uploadJobDetail(finished, now)).toBe('Finishing upload');
});

test('a silent upload expires its estimate instead of keeping a stale number', () => {
    const now = Date.now();
    const running = job({
        status: UploadJobStatus.Active,
        bytesPerSecond: 100,
        etaSeconds: 8,
        etaUpdatedAt: now,
        progress: { phase: UploadPhase.Uploading, completed: 2, reused: 0, total: 4 }
    });

    expect(uploadRate(running, now)).toBe(100);
    expect(uploadJobDetail(running, now)).toBe('Uploading 50%, about 8 s left');
    expect(uploadRate(running, now + ETA_STALE_MS + 1)).toBe(0);
    expect(uploadJobDetail(running, now + ETA_STALE_MS + 1)).toBe('Uploading 50%, estimating...');
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

    expect(uploaded).toBe('Uploaded');
    expect(existing).toBe('Already in Google Photos');
});

test('the retry wait counts down from the stored deadline', () => {
    const now = Date.now();
    const paused = job({ retryAt: now + 120_000 });

    expect(retryRemainingSeconds(paused, now)).toBe(120);
    expect(retryRemainingSeconds(paused, now + 60_000)).toBe(60);
    expect(retryRemainingSeconds(paused, now + 120_000)).toBe(0);
});
