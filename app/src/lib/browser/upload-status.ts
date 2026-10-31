import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { formatDuration, throttleMessage } from '@madkarmaa/phodrive-core/browser/upload/eta';
import type { UploadJob } from '#browser/files';

export function retryRemainingSeconds(job: UploadJob, now = Date.now()): number | null {
    if (job.retryAt === null) return null;

    return Math.max(0, Math.ceil((job.retryAt - now) / 1_000));
}

export function uploadJobDetail(job: UploadJob, now = Date.now()): string {
    const progress = job.progress;
    const processed =
        progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0);
    const percent = progress.total ? Math.round((processed / progress.total) * 100) : 0;

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

        return `Paused${place}. ${throttleMessage(pause)}`;
    }
    if (progress.phase === UploadPhase.Preparing) return `Preparing ${percent}%`;
    if (processed === progress.total) return 'Finishing upload';

    const eta = job.etaSeconds === null ? '' : `, about ${formatDuration(job.etaSeconds)} left`;

    return `Uploading ${percent}%${eta}`;
}
