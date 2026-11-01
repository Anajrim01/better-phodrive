import {
    groupChunks,
    sortFiles,
    filterFiles,
    fileType,
    childFolders,
    folderTrail,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import {
    readGroupLibrary,
    readGroupLibraryUpdates,
    readLibraryPage,
    readLibrarySnapshot,
    readLibrarySync
} from '@madkarmaa/phodrive-core/browser/library';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import {
    applyGroupSnapshot,
    applyLibrarySnapshot,
    applyLibrarySync,
    reportLoadFailure,
    resetLibraryPages
} from '#browser/drive/library-state';

const POST_UPLOAD_COOLDOWN_MS = 2 * 60 * 1_000;

export type LibraryGroup = {
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

    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    folder = $state('');
    loadFailed = $state(false);
    retryAt = $state(0);
    cooldownUntil = $state(0);

    files = $derived(groupChunks(this.chunks));
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
        this.folder = '';
        this.chunks = [];
        resetLibraryPages(this, this.libraryPageTokens);
        this.libraryRequest++;
        this.loading = false;
        this.accounts = [];
        this.partial = false;
    }

    openFolder(path: string) {
        if (path && !this.hasFolder(path)) return;

        this.folder = path;
    }

    private hasFolder(path: string): boolean {
        const prefix = `${path}/`;

        return this.files.some((file) => file.folder === path || file.folder.startsWith(prefix));
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
                if (firstPage && data.revision !== undefined)
                    this.revisions.set(email.toLowerCase(), data.revision);

                this.loadedPages++;
            },
            Err: (error) => reportLoadFailure(this, error, this.feedback)
        });
        this.loading = false;
    }

    private async loadGroup(group: NonNullable<LibraryGroup>, reset: boolean, full = true) {
        if (this.actionsDisabled() || (!reset && this.loading)) return;

        const request = ++this.libraryRequest;
        if (reset) {
            this.chunks = [];
            resetLibraryPages(this, this.libraryPageTokens);
            this.accounts = [];
            this.partial = false;
        }

        this.loading = true;
        this.feedback('');

        const loaded = full
            ? await readGroupLibrary(group.members, group.missing)
            : await readGroupLibraryUpdates(
                  group.members,
                  group.missing,
                  this.chunks,
                  this.accounts,
                  this.revisions
              );
        if (request !== this.libraryRequest) return;

        loaded.match({
            Ok: (snapshot) =>
                applyGroupSnapshot(this, snapshot, this.onAccounts, (path) => this.hasFolder(path)),
            Err: (error) => reportLoadFailure(this, error, this.feedback)
        });

        this.loading = false;
    }

    async refresh(manual = false) {
        const group = this.group();
        if (group) {
            if (this.actionsDisabled() || this.loading || document.hidden) return;
            if (!manual && (Date.now() < this.retryAt || Date.now() < this.cooldownUntil)) return;

            if (manual) await this.loadGroup(group, false);
            else await this.loadGroup(group, false, false);

            return;
        }

        if (this.actionsDisabled() || this.loading || document.hidden) return;
        if (!manual && (Date.now() < this.retryAt || Date.now() < this.cooldownUntil)) return;

        const { email, token } = this.account();
        if (!email || !token) return;

        const request = ++this.libraryRequest;
        this.loading = true;

        if (manual) {
            const refreshed = await readLibrarySnapshot(email, token, this.loadedPages);
            if (request !== this.libraryRequest || email !== this.account().email) return;

            refreshed.match({
                Ok: (snapshot) =>
                    applyLibrarySnapshot(this, email, snapshot, this.libraryPageTokens, (path) =>
                        this.hasFolder(path)
                    ),
                Err: (error) => reportLoadFailure(this, error, this.feedback)
            });

            this.loading = false;

            return;
        }

        const cursor = this.revisions.get(email.toLowerCase()) ?? 0;
        const synced = await readLibrarySync(email, token, false, cursor);
        if (request !== this.libraryRequest || email !== this.account().email) return;

        synced.match({
            Ok: (update) =>
                applyLibrarySync(this, email, update, this.libraryPageTokens, (path) =>
                    this.hasFolder(path)
                ),
            Err: (error) => reportLoadFailure(this, error, this.feedback)
        });

        this.loading = false;
    }

    deferRefresh(): void {
        this.cooldownUntil = Date.now() + POST_UPLOAD_COOLDOWN_MS;
    }
}
