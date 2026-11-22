import {
    UploadJobStatus,
    type GoogleAccountSummary,
    type ProcessingMode
} from '@madkarmaa/phodrive-core/models';
import type { DriveContextState } from '#browser/drive/context.svelte';
import type { DriveLibrary } from '#browser/drive/library.svelte';
import type { DriveSettings } from '#browser/drive/settings.svelte';
import { createUploadJobs, type UploadJob } from '#browser/files';
import { failUnfinishedJobs, replaceJob } from '#browser/drive/chunks';
import { planUploads, type UploadQueue } from '#browser/drive/upload-plan';
import { retryTarget } from '#browser/drive/upload-retry';
import { runUploadQueue } from '#browser/drive/upload-queue';
import { uploadWarningMessage } from '#browser/drive/upload-warning';

export class DriveUploads {
    panelOpen = $state(false);
    running = $state(false);
    jobs = $state<UploadJob[]>([]);

    private sources: readonly File[] = [];
    private readonly owners = new Map<number, GoogleAccountSummary>();
    private readonly folders = new Map<number, string>();
    private abort: AbortController | null = null;

    constructor(
        private readonly context: () => DriveContextState,
        private readonly library: DriveLibrary,
        private readonly settings: DriveSettings,
        private readonly processing: ProcessingMode,
        private readonly disabled: () => boolean,
        private readonly feedback: (message: string) => void
    ) {}

    cancel() {
        this.abort?.abort();
    }

    async upload(files: readonly File[]) {
        if (this.disabled() || files.length === 0) return;

        if (this.library.loading) {
            this.feedback(
                'Files are refreshing. Wait for the refresh to finish, then select your files again.'
            );

            return;
        }

        const context = this.context().current;
        if (!context) {
            this.feedback('Connect a Google account before uploading.');

            return;
        }
        if (context.kind === 'group' && context.group.members.length === 0) {
            this.feedback('Add an account to this group before uploading.');

            return;
        }

        this.sources = [...files];
        const plan = planUploads(files, context, this.library.folder);
        this.jobs = plan.jobs;
        this.owners.clear();
        this.folders.clear();
        for (const [jobId, account] of plan.owners) this.owners.set(jobId, account);
        for (const [jobId, folder] of plan.folders) this.folders.set(jobId, folder);

        if (!plan.queues.length) {
            this.panelOpen = true;

            return;
        }

        await this.run(plan.queues);
    }

    async retry(id: number) {
        if (this.disabled() || this.library.loading) return;

        const target = retryTarget({
            jobs: this.jobs,
            sources: this.sources,
            owners: this.owners,
            folders: this.folders,
            accounts: this.context().accounts,
            id
        });
        if (!target) return;
        if (typeof target === 'string') {
            this.feedback(target);

            return;
        }

        this.jobs = replaceJob(this.jobs, id, createUploadJobs([target.file])[0]);

        await this.run(
            [
                {
                    account: target.owner,
                    files: [target.file],
                    jobIds: [id],
                    folders: [target.folder]
                }
            ],
            id
        );
    }

    private async run(queues: readonly UploadQueue[], retryId?: number) {
        this.panelOpen = true;
        this.feedback('');
        this.running = true;

        const controller = new AbortController();
        this.abort = controller;

        try {
            await Promise.all(
                queues.map((queue) =>
                    runUploadQueue({
                        queue,
                        workers: this.settings.concurrentWorkers,
                        processing: this.processing,
                        library: this.library,
                        retryId,
                        signal: controller.signal,
                        onJob: (job, id) => {
                            this.jobs = replaceJob(this.jobs, id, job);
                            if (job.status === UploadJobStatus.Error) this.feedback(job.message);
                            else if (job.status === UploadJobStatus.Complete) {
                                const warning = uploadWarningMessage(job.result?.warnings);
                                if (warning) this.feedback(warning);
                            }
                        },
                        onError: (message, jobIds) => {
                            this.feedback(message);
                            this.jobs = failUnfinishedJobs(this.jobs, message, jobIds);
                        }
                    })
                )
            );

            if (controller.signal.aborted)
                this.jobs = failUnfinishedJobs(
                    this.jobs,
                    'Upload cancelled.',
                    queues.flatMap((queue) => queue.jobIds)
                );
        } finally {
            if (this.abort === controller) this.abort = null;
            this.running = false;
        }
    }
}
