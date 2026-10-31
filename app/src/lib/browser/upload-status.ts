import { UploadJobStatus, UploadPhase, UploadStatus } from '@madkarmaa/phodrive-core/models';
import { formatDuration } from '@madkarmaa/phodrive-core/browser/upload/eta';
import type { UploadJob } from '#browser/files';

export function uploadJobDetail(job: UploadJob): string {
    const progress = job.progress;
    const processed =
        progress.completed + (progress.phase === UploadPhase.Uploading ? progress.reused : 0);
    const percent = progress.total ? Math.round((processed / progress.total) * 100) : 0;

    if (job.status === UploadJobStatus.Queued) return 'Waiting';
    if (job.status === UploadJobStatus.Error) return job.message;
    if (job.status === UploadJobStatus.Complete)
        return job.result?.status === UploadStatus.AlreadyExists
            ? 'Already in Google Photos'
            : 'Uploaded';
    if (job.retryAfterSeconds !== null) {
        const place = percent > 0 ? ` at ${percent}%` : '';

        return `Paused${place}, retrying in about ${formatDuration(job.retryAfterSeconds)}`;
    }
    if (progress.phase === UploadPhase.Receiving) return 'Sending files to server';
    if (progress.phase === UploadPhase.Preparing) return `Preparing ${percent}%`;
    if (processed === progress.total) return 'Finishing upload';

    const eta = job.etaSeconds === null ? '' : `, about ${formatDuration(job.etaSeconds)} left`;

    return `Uploading ${percent}%${eta}`;
}
