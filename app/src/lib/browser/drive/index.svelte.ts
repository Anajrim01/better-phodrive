import {
    ConfirmKind,
    FileActionKind,
    DEFAULT_PREFERENCES_DEFAULTS,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { watch } from 'runed';
import type { FileGroup, FileAction } from '@madkarmaa/phodrive-core/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import type { UploadJob } from '#browser/files';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';
import { DriveAccounts } from '#browser/drive/accounts.svelte';
import { DriveGroups } from '#browser/drive/groups.svelte';
import { DriveUploads } from '#browser/drive/uploads.svelte';
import { DriveFiles, type ConfirmTarget } from '#browser/drive/files.svelte';
import { DriveSession } from '#browser/drive/session.svelte';
import { DriveView } from '#browser/drive/view.svelte';

export type { ConfirmTarget } from '#browser/drive/files.svelte';

export class DriveController extends DriveView {
    ready = $state(false);
    feedbackMessage = $state('');
    accountMenuOpen = $state(false);

    readonly library: DriveLibrary;
    readonly settings: DriveSettings;
    readonly groupSettings: DriveGroups;
    private readonly accountsState: DriveAccounts;
    protected readonly uploads: DriveUploads;
    protected readonly files: DriveFiles;
    private readonly session: DriveSession;

    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {
        super();

        const feedback = (message: string) => {
            this.feedbackMessage = message;
        };

        this.settings = new DriveSettings(() => this.preferences, defaults, feedback);
        this.accountsState = new DriveAccounts({
            defaults,
            blocked: () => this.busy || !!this.fileAction,
            feedback
        });
        this.groupSettings = new DriveGroups(
            () => this.preferences,
            () => this.accounts,
            feedback
        );
        this.library = new DriveLibrary(
            () => this.account(),
            () => this.busy || !!this.fileAction,
            () => this.settings.fileSort,
            feedback
        );
        this.uploads = new DriveUploads({
            account: () => this.account(),
            folder: () => this.library.folder,
            workers: () => this.settings.concurrentWorkers,
            loading: () => this.library.loading,
            blocked: () => !!this.files.action,
            preferences: () => this.accountsState.preferences,
            feedback,
            onChunk: (saved) => {
                this.library.chunks = [
                    saved,
                    ...this.library.chunks.filter(
                        (item) =>
                            item.email !== saved.email ||
                            item.mediaKey !== saved.mediaKey ||
                            item.fileId !== saved.fileId ||
                            item.chunkIndex !== saved.chunkIndex
                    )
                ];
            },
            afterUpload: () => this.library.deferRefresh(),
            reload: (email, token) => this.session.reload(email, token)
        });
        this.session = new DriveSession({
            busy: () => this.busy,
            fileAction: () => !!this.fileAction,
            resetLibrary: () => this.library.reset(),
            loadLibrary: () => void this.library.load(),
            resetUploads: () => this.uploads.reset(),
            clearConfirmation: () => {
                this.confirmOpen = false;
                this.confirmTarget = null;
            },
            clearFeedback: () => {
                this.feedbackMessage = '';
            },
            matches: (email, token) =>
                this.selectedEmail === email && this.accounts[email] === token
        });
        this.files = new DriveFiles({
            account: () => this.account(),
            busy: () => this.uploads.busy,
            loading: () => this.library.loading,
            files: () => this.library.files,
            workers: () => this.settings.concurrentWorkers,
            feedback,
            onDeleted: (item, chunk) => {
                this.library.chunks = this.library.chunks.filter(
                    (saved) =>
                        saved.email !== item.email ||
                        saved.mediaKey !== chunk.mediaKey ||
                        saved.sha1 !== chunk.sha1
                );
            },
            closeUploads: () => {
                this.uploads.panelOpen = false;
            },
            reload: (email, token) => this.session.reload(email, token),
            removeAccount: (email) => this.removeAccount(email)
        });

        watch(
            [() => this.selectedEmail, () => this.accounts[this.selectedEmail]],
            ([email, token], [previousEmail, previousToken]) => {
                if (!this.ready || (email === previousEmail && token === previousToken)) return;

                this.session.reset();
            }
        );

        useAutomaticRefresh(
            () => this.settings.refreshIntervalSeconds,
            () =>
                this.ready &&
                !!this.selectedEmail &&
                !this.busy &&
                !this.fileAction &&
                !this.library.loading,
            () => this.library.refresh()
        );
    }

    get preferences() {
        return this.accountsState.preferences;
    }

    get accounts() {
        return this.accountsState.accounts;
    }

    get selectedEmail() {
        return this.accountsState.selectedEmail;
    }

    get adding() {
        return this.accountsState.adding;
    }

    set adding(value: boolean) {
        this.accountsState.adding = value;
    }

    get newEmail() {
        return this.accountsState.newEmail;
    }

    set newEmail(value: string) {
        this.accountsState.newEmail = value;
    }

    get newToken() {
        return this.accountsState.newToken;
    }

    set newToken(value: string) {
        this.accountsState.newToken = value;
    }

    get connecting() {
        return this.accountsState.connecting;
    }

    private account() {
        return { email: this.selectedEmail, token: this.accounts[this.selectedEmail] };
    }

    initialize() {
        const parsedTheme = ThemeSchema.safeParse(document.documentElement.getAttribute('theme'));
        if (parsedTheme.success) this.settings.themeMode = parsedTheme.data;

        this.accountsState.initialize();
        this.ready = true;
    }

    async saveAccount() {
        await this.accountsState.save();
    }

    selectAccount(email: string) {
        this.accountsState.select(email);
    }

    removeAccount(email: string) {
        this.accountsState.remove(email);
    }

    confirmAction() {
        this.files.confirm();
    }

    async actOnFile(item: FileGroup, action: FileActionKind) {
        await this.files.act(item, action);
    }

    async upload(files: readonly File[]) {
        await this.uploads.upload(files);
    }

    async retryUpload(id: number) {
        await this.uploads.retry(id);
    }
}
