import {
    filterFiles,
    folderTrail,
    fileType,
    ownerKey,
    partitionFileGroups,
    sortFiles,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { readLibraryPage, readLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';
import { withTrashState, withoutChunk, withChunks } from '#browser/drive/chunks';
import type { DriveContext } from '#browser/drive/context.svelte';
import { FolderNavigation } from '#browser/drive/folder-navigation';
import type { FolderOpenMode } from '#browser/drive/folder-history';
import { foldersFor, visibleFilesFor } from '#browser/drive/library-folders';
import {
    cursorFor,
    failureMessage,
    flattenChunks,
    hasMore as libraryHasMore,
    libraryMembers,
    mergeAccountChunks,
    pruneCursors,
    type AccountCursor,
    type MemberFailure
} from '#browser/drive/library-state';

/** Library pagination, filtering, and stale-request protection for one account or a group. */
export class DriveLibrary {
    chunks = $state<UploadedChunk[]>([]);
    hasMore = $state(false);
    loading = $state(false);

    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    folder = $state('');
    loadFailed = $state(false);

    private libraryRequest = 0;
    private readonly cursors = new Map<string, AccountCursor>();
    private readonly chunksByAccount = new Map<string, UploadedChunk[]>();
    private readonly navigation: FolderNavigation;
    private readonly partitioned = $derived(partitionFileGroups(this.chunks));

    files = $derived(this.partitioned.files);
    trashFiles = $derived(this.partitioned.trash);
    availableTypes = $derived([...new Set(this.files.map((item) => fileType(item.name)))].sort());
    filtering = $derived(!!(this.searchTerm || this.typeFilter || this.modifiedDays));
    folders = $derived(foldersFor(this.files, this.folder, this.filtering));
    trail = $derived(folderTrail(this.folder));
    visibleFiles = $derived.by(() =>
        visibleFilesFor(
            this.files,
            this.folder,
            this.filtering,
            this.searchTerm,
            this.typeFilter,
            this.modifiedDays,
            this.sortOrder()
        )
    );
    trashVisible = $derived.by(() =>
        sortFiles(filterFiles(this.trashFiles, this.searchTerm, '', ''), this.sortOrder())
    );

    constructor(
        private readonly context: () => DriveContext | null,
        private readonly actionsDisabled: () => boolean,
        private readonly sortOrder: () => FileSort,
        private readonly feedback: (message: string) => void
    ) {
        this.navigation = new FolderNavigation(
            () => this.folder,
            (folder) => {
                this.folder = folder;
            },
            () => this.files
        );
    }

    openFolder(path: string, mode: FolderOpenMode = 'push') {
        this.navigation.open(path, mode);
    }

    reset() {
        this.searchTerm = '';
        this.typeFilter = '';
        this.modifiedDays = '';
        this.navigation.reset();
        this.chunks = [];
        this.hasMore = false;
        this.cursors.clear();
        this.chunksByAccount.clear();
        this.libraryRequest++;
        this.loading = false;
        this.loadFailed = false;
    }

    async load(reset = true) {
        if (this.actionsDisabled() || (!reset && (this.loading || !this.hasMore))) return;

        const members = libraryMembers(this.context());
        const request = ++this.libraryRequest;

        if (reset) {
            this.chunks = [];
            this.chunksByAccount.clear();
            this.cursors.clear();
            this.hasMore = false;
            this.loadFailed = false;
        } else {
            pruneCursors(this.cursors, this.chunksByAccount, members);
        }

        this.loading = true;
        this.feedback('');

        if (!members.length) {
            this.loading = false;

            return;
        }

        const failures: MemberFailure[] = [];
        let successes = 0;

        for (const account of members) {
            const cursor = cursorFor(this.cursors, account);
            const pageToken = reset ? '' : cursor.pageToken;
            if (!reset && !pageToken) continue;

            const loaded = await readLibraryPage(pageToken, account.id);
            if (request !== this.libraryRequest) return;

            if (loaded.isErr()) {
                failures.push({ account, message: loaded.unwrapErr().message });
                if (reset) this.chunksByAccount.set(account.id, []);
                continue;
            }

            const data = loaded.unwrap();
            const found = data.items.map((item): UploadedChunk => ({
                ...item,
                email: account.email
            }));
            const existing = reset ? [] : (this.chunksByAccount.get(account.id) ?? []);
            this.chunksByAccount.set(account.id, mergeAccountChunks(existing, found));
            cursor.loadedPages = reset ? 1 : cursor.loadedPages + 1;
            cursor.pageToken = data.nextPageToken;
            successes++;

            if (data.nextPageToken && cursor.pageTokens.has(data.nextPageToken)) {
                cursor.pageToken = '';
                failures.push({
                    account,
                    message: 'Google Photos repeated a library page. Refresh to try again.'
                });
            } else if (cursor.pageToken) {
                cursor.pageTokens.add(cursor.pageToken);
            }
        }

        const applied = this.finish(request, failures, successes);
        if (applied) this.navigation.settle(this.hasMore);
    }

    async refresh() {
        if (this.actionsDisabled() || this.loading || document.hidden) return;

        const members = libraryMembers(this.context());
        const request = ++this.libraryRequest;
        pruneCursors(this.cursors, this.chunksByAccount, members);
        this.loading = true;

        if (!members.length) {
            this.chunks = [];
            this.chunksByAccount.clear();
            this.hasMore = false;
            this.loadFailed = false;
            this.loading = false;

            return;
        }

        const failures: MemberFailure[] = [];
        let successes = 0;

        for (const account of members) {
            const cursor = cursorFor(this.cursors, account);
            const refreshed = await readLibrarySnapshot(
                Math.max(1, cursor.loadedPages),
                account.id
            );
            if (request !== this.libraryRequest) return;

            if (refreshed.isErr()) {
                failures.push({ account, message: refreshed.unwrapErr().message });
                continue;
            }

            const snapshot = refreshed.unwrap();
            this.chunksByAccount.set(
                account.id,
                snapshot.items.map((item) => ({ ...item, email: account.email }))
            );
            cursor.loadedPages = snapshot.pages;
            cursor.pageToken = snapshot.nextPageToken;
            cursor.pageTokens.clear();
            if (cursor.pageToken) cursor.pageTokens.add(cursor.pageToken);
            successes++;
        }

        const applied = this.finish(request, failures, successes);
        if (applied) this.navigation.settle(this.hasMore);
    }

    appendChunks(saved: readonly UploadedChunk[]) {
        for (const chunk of saved) {
            const key = ownerKey(chunk);
            const existing = this.chunksByAccount.get(key) ?? [];
            this.chunksByAccount.set(key, mergeAccountChunks(existing, [chunk]));
        }

        this.chunks = withChunks(this.chunks, saved);
    }

    removeChunk(file: FileGroup, removed: { mediaKey: string; sha1: string }) {
        const key = ownerKey(file);
        const existing = this.chunksByAccount.get(key);

        if (existing)
            this.chunksByAccount.set(
                key,
                existing.filter(
                    (chunk) => chunk.mediaKey !== removed.mediaKey || chunk.sha1 !== removed.sha1
                )
            );

        this.chunks = withoutChunk(this.chunks, file, removed);
    }

    markChunkTrashed(file: FileGroup, chunk: UploadedChunk) {
        this.setTrashState(file, chunk, true);
    }

    markChunkRestored(file: FileGroup, chunk: UploadedChunk) {
        this.setTrashState(file, chunk, false);
    }

    private setTrashState(file: FileGroup, chunk: UploadedChunk, trashed: boolean) {
        const key = ownerKey(file);
        const existing = this.chunksByAccount.get(key);

        if (existing) this.chunksByAccount.set(key, withTrashState(existing, file, chunk, trashed));

        this.chunks = withTrashState(this.chunks, file, chunk, trashed);
    }

    private finish(
        request: number,
        failures: readonly MemberFailure[],
        successes: number
    ): boolean {
        if (request !== this.libraryRequest) return false;

        this.chunks = flattenChunks(this.chunksByAccount);
        this.hasMore = libraryHasMore(this.cursors);
        this.loadFailed = failures.length > 0 && successes === 0;
        this.loading = false;

        const message = failureMessage(libraryMembers(this.context()), failures);
        if (message) this.feedback(message);

        return successes > 0;
    }
}
