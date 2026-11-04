import { UploadJobStatus, type GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import type { UploadJob } from '#browser/files';

type RetryTargetInput = {
    jobs: readonly UploadJob[];
    sources: readonly File[];
    owners: ReadonlyMap<number, GoogleAccountSummary>;
    folders: ReadonlyMap<number, string>;
    accounts: readonly GoogleAccountSummary[];
    id: number;
};

export type RetryTarget = {
    file: File;
    owner: GoogleAccountSummary;
    folder: string;
};

/** Resolve a failed upload's recorded file, owner, and folder, or return a user-facing reason. */
export function retryTarget({
    jobs,
    sources,
    owners,
    folders,
    accounts,
    id
}: RetryTargetInput): RetryTarget | string | null {
    const job = jobs.find((current) => current.id === id);
    const file = sources[id];
    if (!job || job.status !== UploadJobStatus.Error || job.retryable === false || !file)
        return null;

    const recorded = owners.get(id);
    if (!recorded) return 'This upload has no assigned account.';

    const folder = folders.get(id);
    if (folder === undefined) return 'This upload has no recorded folder.';

    const owner = accounts.find((account) => account.id === recorded.id);
    if (!owner) return 'The Google account for this upload is no longer connected.';

    return { file, owner, folder };
}
