import {
    FileActionKind,
    UploadJobStatus,
    DEFAULT_PREFERENCES_DEFAULTS,
    ProcessingMode,
    ThemeSchema,
    type GoogleAccountSummary,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { DriveAccount } from '#browser/drive/account.svelte';
import { DriveContextState } from '#browser/drive/context.svelte';
import {
    createBrowserPreferences,
    type BrowserPreferences,
    type DriveContextSelection
} from '#browser/storage';
import { createUploadJobs, type UploadJob } from '#browser/files';
import { downloadAndSave, trashFile, uploadBatch } from '#browser/drive/actions';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';
import { failUnfinishedJobs, replaceJob, unchangedFile } from '#browser/drive/chunks';
import { planUploads, type UploadQueue } from '#browser/drive/upload-plan';

/** The signed-in user's drive; their Google account and token stay on the server. */
export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);

    ready = $state(false);
    busy = $state(false);
    uploadPanelOpen = $state(false);
    uploadJobs = $state<UploadJob[]>([]);
    private uploadSources: readonly File[] = [];
    private readonly uploadOwners = new Map<number, GoogleAccountSummary>();
    private uploadAbort: AbortController | null = null;

    feedbackMessage = $state('');
    fileAction = $state<FileAction | null>(null);
    accountMenuOpen = $state(false);
    confirmOpen = $state(false);
    confirmTarget = $state<FileGroup | null>(null);

    readonly context: DriveContextState;
    readonly library: DriveLibrary;
    readonly settings: DriveSettings;
    readonly account: DriveAccount;

    constructor(
        readonly email: string,
        private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS,
        readonly processing: ProcessingMode = ProcessingMode.Browser
    ) {
        const feedback = (message: string) => {
            this.feedbackMessage = message;
        };

        this.settings = new DriveSettings(() => this.preferences, defaults, feedback);
        this.context = new DriveContextState(() => this.preferences, feedback);
        this.library = new DriveLibrary(
            () => this.context.current,
            () => this.working,
            () => this.settings.fileSort,
            feedback
        );

        this.account = new DriveAccount(this.library, () => !this.working, feedback);

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () => this.ready && !this.working && !this.library.loading && !this.context.loading,
            () => this.library.refresh()
        );
    }

    /** An upload or a file action is running. */
    get working(): boolean {
        return this.busy || this.fileAction !== null;
    }

    cancelUploads() {
        this.uploadAbort?.abort();
    }

    initialize() {
        const parsedTheme = ThemeSchema.safeParse(document.documentElement.getAttribute('theme'));
        if (parsedTheme.success) this.settings.themeMode = parsedTheme.data;

        createBrowserPreferences(this.defaults).match({
            Ok: (preferences) => {
                this.preferences = preferences;
            },
            Err: (error) => {
                this.feedbackMessage = error.message;
            }
        });

        this.ready = true;
    }

    /** Resolve the saved account or group, then load its library. */
    async loadDrive() {
        await this.context.load();
        await this.library.load();
    }

    async selectContext(selection: DriveContextSelection) {
        if (this.working) return;

        if (!this.context.select(selection)) {
            this.feedbackMessage = 'The selected library is no longer available.';

            return;
        }

        this.library.reset();
        await this.library.load();
    }

    /** Reload accounts, groups, and the library after Settings changes; skipped during file work. */
    async reloadContext() {
        if (this.working) return;

        await this.context.load();
        this.library.reset();
        await this.library.load();
    }

    confirmAction() {
        const item = this.confirmTarget;
        this.confirmOpen = false;
        this.confirmTarget = null;
        if (!item) return;

        const current = this.library.files.find((file) => fileKey(file) === fileKey(item));
        if (!unchangedFile(current, item)) {
            this.feedbackMessage = 'The file changed. Review its current chunks before deleting.';

            return;
        }

        void this.actOnFile(current, FileActionKind.Delete);
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        if (this.working || this.library.loading) return;

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        const deleting = action === FileActionKind.Delete;
        const done = deleting
            ? await trashFile(this.library, item, this.settings.concurrentWorkers)
            : await downloadAndSave(item, this.processing);

        done.inspectErr((error) => {
            this.feedbackMessage = error.message;
        });

        if (deleting) this.uploadPanelOpen = false;
        this.fileAction = null;
    }

    async upload(files: readonly File[]) {
        if (this.working || files.length === 0) return;

        if (this.library.loading) {
            this.feedbackMessage =
                'Files are refreshing. Wait for the refresh to finish, then select your files again.';

            return;
        }

        const context = this.context.current;
        if (!context) {
            this.feedbackMessage = 'Connect a Google account before uploading.';

            return;
        }
        if (context.kind === 'group' && context.group.members.length === 0) {
            this.feedbackMessage = 'Add an account to this group before uploading.';

            return;
        }

        this.uploadSources = [...files];
        const plan = planUploads(files, context);
        this.uploadJobs = plan.jobs;
        this.uploadOwners.clear();
        for (const [jobId, account] of plan.owners) this.uploadOwners.set(jobId, account);

        if (!plan.queues.length) {
            this.uploadPanelOpen = true;

            return;
        }

        await this.runUploads(plan.queues);
    }

    async retryUpload(id: number) {
        if (this.working || this.library.loading) return;

        const job = this.uploadJobs.find((current) => current.id === id);
        const file = this.uploadSources[id];
        if (!job || job.status !== UploadJobStatus.Error || job.retryable === false || !file)
            return;

        const recorded = this.uploadOwners.get(id);
        if (!recorded) {
            this.feedbackMessage = 'This upload has no assigned account.';

            return;
        }

        const owner = this.context.accounts.find((account) => account.id === recorded.id);
        if (!owner) {
            this.feedbackMessage = 'The Google account for this upload is no longer connected.';

            return;
        }

        this.uploadJobs = replaceJob(this.uploadJobs, id, createUploadJobs([file])[0]);

        await this.runUploads([{ account: owner, files: [file], jobIds: [id] }], id);
    }

    private async runUploads(queues: readonly UploadQueue[], retryId?: number) {
        this.uploadPanelOpen = true;
        this.feedbackMessage = '';
        this.busy = true;

        const controller = new AbortController();
        this.uploadAbort = controller;

        try {
            await Promise.all(
                queues.map(async (queue) => {
                    const uploaded = await uploadBatch({
                        files: queue.files,
                        account: queue.account,
                        workers: this.settings.concurrentWorkers,
                        processing: this.processing,
                        library: this.library,
                        jobIds: queue.jobIds,
                        retryId,
                        signal: controller.signal,
                        onJob: (job, id) => {
                            this.uploadJobs = replaceJob(this.uploadJobs, id, job);
                            if (job.status === UploadJobStatus.Error)
                                this.feedbackMessage = job.message;
                        }
                    });

                    uploaded.inspectErr((error) => {
                        this.feedbackMessage = error.message;
                        this.uploadJobs = failUnfinishedJobs(
                            this.uploadJobs,
                            error.message,
                            queue.jobIds
                        );
                    });
                })
            );

            if (controller.signal.aborted)
                this.uploadJobs = failUnfinishedJobs(
                    this.uploadJobs,
                    'Upload cancelled.',
                    queues.flatMap((queue) => queue.jobIds)
                );
        } finally {
            if (this.uploadAbort === controller) this.uploadAbort = null;
            this.busy = false;
        }
    }
}
