import {
    sortFiles,
    filterFiles,
    fileType,
    childFolders,
    folderTrail,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { partitionFileGroups } from '@madkarmaa/phodrive-core/trash';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { readLibraryPage, readLibrarySync } from '@madkarmaa/phodrive-core/browser/library';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import {
    applyLibrarySync,
    reportLoadFailure,
    resetLibraryPages
} from '#browser/drive/library-state';
import {
    loadGroupLibrary,
    loadLibrarySyncSnapshot,
    refreshGroupLibrary,
    refreshLibrary
} from '#browser/drive/library-refresh';
import type { FolderOpenMode } from '#browser/drive/folder-history';
import { FolderNavigation } from '#browser/drive/folder-navigation';

const POST_UPLOAD_COOLDOWN_MS = 2 * 60 * 1_000;

type LibraryGroup = {
    members: readonly { email: string; token: string; pausedUntil?: number }[];
    missing: readonly string[];
} | null;

export class DriveLibrary {
    chunks = $state<UploadedChunk[]>([]);
    nextPageToken = $state('');
    loading = $state(false);
    accounts = $state<GroupAccountState[]>([]);
    partial = $state(false);

    private libraryRequest = 0;
    loadedPages = 0;
    revisions = new Map<string, number>();
    private libraryPageTokens = new Set<string>();
    private readonly navigation = new FolderNavigation({
        folder: () => this.folder,
        setFolder: (folder) => (this.folder = folder),
        files: () => this.files
    });

    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    folder = $state('');
    loadFailed = $state(false);
    retryAt = $state(0);
    cooldownUntil = $state(0);

    private grouped = $derived(partitionFileGroups(this.chunks));
    files = $derived(this.grouped.files);
    initialLoading = $derived(this.loading && this.chunks.length === 0);
    trashFiles = $derived(this.grouped.trashed);
    availableTypes = $derived([...new Set(this.files.map((item) => fileType(item.name)))].sort());
    filtering = $derived(!!(this.searchTerm || this.typeFilter || this.modifiedDays));
    folders = $derived(childFolders(this.files, this.folder));
    trail = $derived(folderTrail(this.folder));
    visibleFiles = $derived.by(() => {
        const scoped = this.filtering
            ? this.files
            : this.files.filter((file) => file.folder === this.folder);

        return sortFiles(
            filterFiles(scoped, this.searchTerm, this.typeFilter, this.modifiedDays),
            this.sortOrder()
        );
    });

    constructor(
        private readonly account: () => { email: string; token: string | undefined },
        private readonly actionsDisabled: () => boolean,
        private readonly sortOrder: () => FileSort,
        private readonly feedback: (message: string) => void,
        private readonly group: () => LibraryGroup = () => null,
        private readonly onAccounts: (accounts: GroupAccountState[]) => void = () => {}
    ) {}

    reset() {
        this.searchTerm = '';
        this.typeFilter = '';
        this.modifiedDays = '';
        this.navigation.reset();
        this.chunks = [];
        resetLibraryPages(this, this.libraryPageTokens);
        this.libraryRequest++;
        this.loading = false;
        this.accounts = [];
        this.partial = false;
        this.retryAt = 0;
    }

    openFolder(path: string, mode: FolderOpenMode = 'push') {
        this.navigation.open(path, mode);
    }

    async load(reset = true) {
        const group = this.group();
        if (group) {
            await this.loadGroup(group, reset);

            return;
        }

        if (this.actionsDisabled() || (!reset && (this.loading || !this.nextPageToken))) return;

        const { email, token } = this.account();
        const pageToken = reset ? '' : this.nextPageToken;
        const firstPage = pageToken === '';
        const request = ++this.libraryRequest;
        if (reset) {
            this.chunks = [];
            resetLibraryPages(this, this.libraryPageTokens);
        }

        if (!email || !token) {
            this.loading = false;

            return;
        }

        this.loading = true;
        this.feedback('');

        if (firstPage) {
            const synced = await loadLibrarySyncSnapshot(
                this,
                email,
                token,
                this.libraryPageTokens,
                this.navigation.hasOrPending,
                () => request === this.libraryRequest && email === this.account().email
            );
            if (request !== this.libraryRequest || email !== this.account().email) return;

            if (synced) {
                this.navigation.settle(!!this.nextPageToken);
                this.loading = false;

                return;
            }
        }

        const loaded = await readLibraryPage(email, token, pageToken);

        if (request !== this.libraryRequest || email !== this.account().email) return;

        loaded.match({
            Ok: (data) => {
                this.loadFailed = false;

                const found: UploadedChunk[] = data.items.map((item) => ({
                    ...item,
                    email
                }));
                const chunks = reset ? found : [...this.chunks, ...found];
                this.chunks = [
                    ...new Map(
                        chunks.map((item) => [`${item.email}:${item.mediaKey}`, item])
                    ).values()
                ];
                this.nextPageToken = data.nextPageToken;
                if (data.nextPageToken && this.libraryPageTokens.has(data.nextPageToken)) {
                    this.nextPageToken = '';
                    this.loadFailed = true;
                    this.feedback('Google Photos repeated a library page. Refresh to try again.');
                }
                if (this.nextPageToken) this.libraryPageTokens.add(this.nextPageToken);
                if (firstPage) this.revisions.set(email.toLowerCase(), data.revision);

                this.loadedPages++;
                this.navigation.settle(!!this.nextPageToken);
            },
            Err: (error) => reportLoadFailure(this, error, this.feedback)
        });
        this.loading = false;
    }

    private async loadGroup(group: NonNullable<LibraryGroup>, reset: boolean) {
        if (this.actionsDisabled() || (!reset && this.loading)) return;

        const request = ++this.libraryRequest;
        const applied = await loadGroupLibrary(
            this,
            group,
            reset,
            this.libraryPageTokens,
            this.onAccounts,
            this.navigation.hasOrPending,
            this.feedback,
            () => request === this.libraryRequest
        );
        if (request !== this.libraryRequest) return;

        if (applied) this.navigation.settle(false);
        this.loading = false;
    }

    async refresh(manual = false) {
        const group = this.group();
        if (group) {
            if (this.actionsDisabled() || this.loading || document.hidden) return;
            if (!manual && (Date.now() < this.retryAt || Date.now() < this.cooldownUntil)) return;

            const request = ++this.libraryRequest;
            this.loading = true;
            this.feedback('');

            const applied = await refreshGroupLibrary(
                this,
                group,
                this.onAccounts,
                this.navigation.hasOrPending,
                this.feedback,
                () => request === this.libraryRequest
            );
            if (request !== this.libraryRequest) return;

            if (applied) this.navigation.settle(false);
            this.loading = false;

            return;
        }

        if (this.actionsDisabled() || this.loading || document.hidden) return;
        if (!manual && (Date.now() < this.retryAt || Date.now() < this.cooldownUntil)) return;

        const { email, token } = this.account();
        if (!email || !token) return;

        const request = ++this.libraryRequest;
        this.loading = true;

        if (manual) {
            const cursor = this.revisions.get(email.toLowerCase()) ?? 0;
            const applied = await refreshLibrary(
                this,
                email,
                token,
                cursor,
                this.libraryPageTokens,
                this.navigation.hasOrPending,
                this.feedback,
                () => request === this.libraryRequest && email === this.account().email
            );
            if (request !== this.libraryRequest || email !== this.account().email) return;

            if (applied) this.navigation.settle(!!this.nextPageToken);
            this.loading = false;

            return;
        }

        const cursor = this.revisions.get(email.toLowerCase()) ?? 0;
        const synced = await readLibrarySync(email, token, false, cursor);
        if (request !== this.libraryRequest || email !== this.account().email) return;

        synced.match({
            Ok: (update) => {
                applyLibrarySync(
                    this,
                    email,
                    update,
                    this.libraryPageTokens,
                    this.navigation.hasOrPending
                );
                this.navigation.settle(!!this.nextPageToken);
            },
            Err: (error) => reportLoadFailure(this, error, this.feedback)
        });

        this.loading = false;
    }

    deferRefresh(): void {
        this.cooldownUntil = Date.now() + POST_UPLOAD_COOLDOWN_MS;
    }
}
