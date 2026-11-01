import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { formatDuration } from '@madkarmaa/phodrive-core/browser/upload/eta';
import type { UploadJob } from '#browser/files';

export const ETA_STALE_MS = 10_000;

function processedBytes(job: UploadJob): number {
    const progress = job.progress;

    return progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0);
}

export function uploadPercent(job: UploadJob): number {
    const progress = job.progress;
    if (!progress.total) return 0;

    const processed = processedBytes(job);
    const percent = Math.round((processed / progress.total) * 100);
    if (progress.phase === UploadPhase.Uploading && processed < progress.total)
        return Math.min(99, percent);

    return percent;
}

function etaIsFresh(job: UploadJob, now: number): boolean {
    return job.etaUpdatedAt === undefined || now - job.etaUpdatedAt <= ETA_STALE_MS;
}

export function uploadRate(job: UploadJob, now = Date.now()): number {
    if (job.etaSeconds === null || !etaIsFresh(job, now)) return 0;

    return job.bytesPerSecond;
}

export function retryRemainingSeconds(job: UploadJob, now = Date.now()): number | null {
    if (job.retryAt === null) return null;

    return Math.max(0, Math.ceil((job.retryAt - now) / 1_000));
}

export function uploadJobDetail(job: UploadJob, now = Date.now()): string {
    const progress = job.progress;
    const processed = processedBytes(job);
    const percent = uploadPercent(job);

    if (job.status === UploadJobStatus.Queued) return job.message || 'Waiting for an account';
    if (job.status === UploadJobStatus.Error) return job.message;
    if (job.status === UploadJobStatus.Complete)
        return job.result?.status === UploadStatus.AlreadyExists
            ? 'Already in Google Photos'
            : 'Uploaded';
    if (progress.phase === UploadPhase.Receiving) return 'Sending files to server';

    const pause = retryRemainingSeconds(job, now);
    if (pause !== null) {
        const place = percent > 0 ? ` at ${percent}%` : '';

        return `Paused${place}, retrying in about ${formatDuration(Math.max(1, pause))}`;
    }
    if (progress.phase === UploadPhase.Preparing) return `Preparing ${percent}%`;
    if (processed === progress.total) return 'Finishing upload';

    const eta =
        job.etaSeconds === null || !etaIsFresh(job, now)
            ? ', estimating...'
            : `, about ${formatDuration(Math.max(1, job.etaSeconds))} left`;

    return `Uploading ${percent}%${eta}`;
}
