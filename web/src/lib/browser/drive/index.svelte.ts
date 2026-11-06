import {
    FileActionKind,
    DEFAULT_PREFERENCES_DEFAULTS,
    ProcessingMode,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { DriveAccount } from '#browser/drive/account.svelte';
import { DriveContextState } from '#browser/drive/context.svelte';
import {
    createBrowserPreferences,
    type BrowserPreferences,
    type DriveContextSelection
} from '#browser/storage';
import type { UploadJob } from '#browser/files';
import { confirmedFile, performFileAction } from '#browser/drive/file-actions';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';
import { DriveUploads } from '#browser/drive/uploads.svelte';

/** The signed-in user's drive; their Google account and token stay on the server. */
export class DriveController {
    private preferences = $state.raw<BrowserPreferences | null>(null);

    ready = $state(false);

    feedbackMessage = $state('');
    fileAction = $state<FileAction | null>(null);
    accountMenuOpen = $state(false);
    confirmOpen = $state(false);
    confirmTarget = $state<FileGroup | null>(null);
    confirmPermanent = $state(false);

    readonly context: DriveContextState;
    readonly library: DriveLibrary;
    readonly settings: DriveSettings;
    readonly account: DriveAccount;
    private readonly uploads: DriveUploads;

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
        this.uploads = new DriveUploads(
            () => this.context,
            this.library,
            this.settings,
            this.processing,
            () => this.working,
            feedback
        );

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () => this.ready && !this.working && !this.library.loading && !this.context.loading,
            () => this.library.refresh()
        );
    }

    /** An upload or a file action is running. */
    get working(): boolean {
        return this.uploads.running || this.fileAction !== null;
    }

    get busy(): boolean {
        return this.uploads.running;
    }

    set busy(running: boolean) {
        this.uploads.running = running;
    }

    get uploadPanelOpen(): boolean {
        return this.uploads.panelOpen;
    }

    set uploadPanelOpen(open: boolean) {
        this.uploads.panelOpen = open;
    }

    get uploadJobs() {
        return this.uploads.jobs;
    }

    set uploadJobs(jobs: UploadJob[]) {
        this.uploads.jobs = jobs;
    }

    cancelUploads() {
        this.uploads.cancel();
    }

    upload(files: readonly File[]) {
        return this.uploads.upload(files);
    }

    retryUpload(id: number) {
        return this.uploads.retry(id);
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

    requestDelete(item: FileGroup) {
        this.confirmPermanent = false;
        this.confirmTarget = item;
        this.confirmOpen = true;
    }

    requestDeleteForever(item: FileGroup) {
        this.confirmPermanent = true;
        this.confirmTarget = item;
        this.confirmOpen = true;
    }

    confirmAction() {
        const item = this.confirmTarget;
        const permanent = this.confirmPermanent;
        this.confirmOpen = false;
        this.confirmTarget = null;
        this.confirmPermanent = false;
        if (!item) return;

        const current = confirmedFile(this.library, item, permanent);
        if (!current) {
            this.feedbackMessage = 'The file changed. Review its current chunks before continuing.';

            return;
        }

        void this.actOnFile(
            current,
            permanent ? FileActionKind.DeleteForever : FileActionKind.Delete
        );
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        if (this.working || this.library.loading) return;

        this.fileAction = { fileId: item.fileId, kind: action };
        this.feedbackMessage = '';

        const message = await performFileAction(item, action, {
            library: this.library,
            processing: this.processing
        });
        if (message) this.feedbackMessage = message;
        if (action === FileActionKind.Delete || action === FileActionKind.DeleteForever)
            this.uploadPanelOpen = false;

        this.fileAction = null;
    }
}
