import {
    ConfirmKind,
    FileActionKind,
    DEFAULT_PREFERENCES_DEFAULTS,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { DriveGroupMode } from '#browser/drive/group-mode';
import { groupFileAccess, groupLibraryAccess, groupUploadAccess } from '#browser/drive/wiring';
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
import { markChunkRestored, markChunkTrashed, removeChunk } from '#browser/drive/library-chunks';
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
    readonly groupMode: DriveGroupMode;
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
            () => this.accounts
        );
        this.groupMode = new DriveGroupMode(
            () => this.groupSettings,
            () => this.settings,
            () => this.accounts,
            () => this.session.reset()
        );
        const libraryGroup = groupLibraryAccess(this.groupMode, this.groupSettings);
        this.library = new DriveLibrary(
            () => this.account(),
            () => this.busy || !!this.fileAction,
            () => this.settings.fileSort,
            feedback,
            libraryGroup.members,
            libraryGroup.onAccounts
        );
        const uploadGroup = groupUploadAccess(
            this.groupMode,
            this.groupSettings,
            () => void this.library.load()
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
            reload: (email, token) => this.session.reload(email, token),
            ...uploadGroup
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
        const fileGroup = groupFileAccess(this.groupMode, () => void this.library.load());
        this.files = new DriveFiles({
            account: () => this.account(),
            busy: () => this.uploads.busy,
            loading: () => this.library.loading,
            files: () => [...this.library.files, ...this.library.trashFiles],
            workers: () => this.settings.concurrentWorkers,
            feedback,
            onTrashed: (item, chunk) => {
                this.library.chunks = markChunkTrashed(this.library.chunks, item, chunk);
            },
            onRestored: (item, chunk) => {
                this.library.chunks = markChunkRestored(this.library.chunks, item, chunk);
            },
            onRemoved: (item, chunk) => {
                this.library.chunks = removeChunk(this.library.chunks, item, chunk);
            },
            closeUploads: () => {
                this.uploads.panelOpen = false;
            },
            reload: (email, token) => this.session.reload(email, token),
            removeAccount: (email) => this.removeAccount(email),
            ...fileGroup
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

    get accountEditor(): DriveAccounts {
        return this.accountsState;
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
