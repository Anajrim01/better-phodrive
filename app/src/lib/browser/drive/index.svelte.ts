import {
    FileActionKind,
    DEFAULT_PREFERENCES_DEFAULTS,
    ThemeSchema,
    type PreferencesDefaults
} from '@madkarmaa/phodrive-core/models';
import { DriveGroupMode } from '#browser/drive/group-mode';
import { groupLibraryAccess, groupUploadAccess } from '#browser/drive/wiring';
import { watch } from 'runed';
import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { useAutomaticRefresh } from '#browser/drive/refresh.svelte';
import { DriveLibrary } from '#browser/drive/library.svelte';
import { DriveSettings } from '#browser/drive/settings.svelte';
import { DriveAccounts } from '#browser/drive/accounts.svelte';
import { DriveGroups } from '#browser/drive/groups.svelte';
import { DriveUploads } from '#browser/drive/uploads.svelte';
import type { DriveFiles } from '#browser/drive/files.svelte';
import { DriveSession } from '#browser/drive/session.svelte';
import { DriveView } from '#browser/drive/view.svelte';
import { DriveSelection } from '#browser/drive/selection.svelte';
import type { DriveBulk } from '#browser/drive/bulk.svelte';
import { createDriveFiles } from '#browser/drive/files-factory';
import { createDriveBulk } from '#browser/drive/bulk-factory';

export type { ConfirmTarget } from '#browser/drive/files.svelte';

export class DriveController extends DriveView {
    ready = $state(false);
    feedbackMessage = $state('');
    accountMenuOpen = $state(false);

    readonly library: DriveLibrary;
    readonly settings: DriveSettings;
    readonly groupSettings: DriveGroups;
    readonly groupMode: DriveGroupMode;
    readonly selection: DriveSelection;
    readonly bulk: DriveBulk;
    private readonly accountsState: DriveAccounts;
    protected readonly uploads: DriveUploads;
    protected readonly files: DriveFiles;
    private readonly session: DriveSession;

    constructor(private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES_DEFAULTS) {
        super();

        const feedback = (message: string) => {
            this.feedbackMessage = message;
        };

        this.selection = new DriveSelection();
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
            () => this.busy || !!this.fileAction || this.bulk.running,
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
            blocked: () => !!this.files.action || this.bulk.running,
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
            resetLibrary: () => {
                this.selection.clear();
                this.library.reset();
            },
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
        this.files = createDriveFiles(this);
        this.bulk = createDriveBulk(this);

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

    get currentAccount() {
        return this.account();
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
        this.selection.clear();
        this.accountsState.select(email);
    }

    removeAccount(email: string) {
        this.selection.clear();
        this.accountsState.remove(email);
    }

    confirmAction() {
        const target = this.confirmTarget;
        if (target?.kind === 'selection') {
            this.confirmOpen = false;
            this.confirmTarget = null;
            if (target.permanent) void this.bulk.deleteForever(target.files);
            else void this.bulk.delete(target.files);

            return;
        }

        this.files.confirm();
    }

    reloadAccount(email: string, token: string) {
        this.session.reload(email, token);
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
