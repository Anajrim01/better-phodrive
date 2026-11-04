import {
    groupChunks,
    sortFiles,
    filterFiles,
    fileType,
    ownerKey,
    type FileGroup,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { FileSort, type GoogleAccountSummary } from '@madkarmaa/phodrive-core/models';
import { readLibraryPage, readLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';
import { withoutChunk, withChunks } from '#browser/drive/chunks';
import type { DriveContext } from '#browser/drive/context.svelte';

type AccountCursor = {
    account: GoogleAccountSummary;
    pageToken: string;
    loadedPages: number;
    pageTokens: Set<string>;
};

type MemberFailure = { account: GoogleAccountSummary; message: string };

function mergeAccountChunks(
    existing: readonly UploadedChunk[],
    found: readonly UploadedChunk[]
): UploadedChunk[] {
    const chunks = new Map(existing.map((chunk) => [chunk.mediaKey, chunk]));
    for (const chunk of found) chunks.set(chunk.mediaKey, chunk);

    return [...chunks.values()];
}

/** Library pagination, filtering, and stale-request protection for one account or a group. */
export class DriveLibrary {
    chunks = $state<UploadedChunk[]>([]);
    hasMore = $state(false);
    loading = $state(false);

    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    loadFailed = $state(false);

    private libraryRequest = 0;
    private readonly cursors = new Map<string, AccountCursor>();
    private readonly chunksByAccount = new Map<string, UploadedChunk[]>();

    files = $derived(groupChunks(this.chunks));
    availableTypes = $derived([...new Set(this.files.map((item) => fileType(item.name)))].sort());
    visibleFiles = $derived.by(() =>
        sortFiles(
            filterFiles(this.files, this.searchTerm, this.typeFilter, this.modifiedDays),
            this.sortOrder()
        )
    );

    constructor(
        private readonly context: () => DriveContext | null,
        private readonly actionsDisabled: () => boolean,
        private readonly sortOrder: () => FileSort,
        private readonly feedback: (message: string) => void
    ) {}

    reset() {
        this.searchTerm = '';
        this.typeFilter = '';
        this.modifiedDays = '';
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

        const members = this.members();
        const request = ++this.libraryRequest;

        if (reset) {
            this.chunks = [];
            this.chunksByAccount.clear();
            this.cursors.clear();
            this.hasMore = false;
            this.loadFailed = false;
        } else {
            this.prune(members);
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
            const cursor = this.cursor(account);
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

        this.finish(request, failures, successes);
    }

    async refresh() {
        if (this.actionsDisabled() || this.loading || document.hidden) return;

        const members = this.members();
        const request = ++this.libraryRequest;
        this.prune(members);
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
            const cursor = this.cursor(account);
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

        this.finish(request, failures, successes);
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

    private members(): GoogleAccountSummary[] {
        const context = this.context();
        if (!context) return [];

        return context.kind === 'account' ? [context.account] : context.group.members;
    }

    private cursor(account: GoogleAccountSummary): AccountCursor {
        const current = this.cursors.get(account.id);
        if (current) return current;

        const created: AccountCursor = {
            account,
            pageToken: '',
            loadedPages: 0,
            pageTokens: new Set()
        };
        this.cursors.set(account.id, created);

        return created;
    }

    private prune(members: readonly GoogleAccountSummary[]) {
        const ids = new Set(members.map((account) => account.id));

        for (const id of this.cursors.keys())
            if (!ids.has(id)) {
                this.cursors.delete(id);
                this.chunksByAccount.delete(id);
            }
    }

    private finish(request: number, failures: readonly MemberFailure[], successes: number) {
        if (request !== this.libraryRequest) return;

        this.chunks = [...this.chunksByAccount.values()].flat();
        this.hasMore = [...this.cursors.values()].some((cursor) => cursor.pageToken !== '');
        this.loadFailed = failures.length > 0 && successes === 0;
        this.loading = false;

        if (failures.length) {
            const [first] = failures;
            this.feedback(
                this.members().length > 1
                    ? `Could not load ${first.account.email}: ${first.message}`
                    : first.message
            );
        }
    }
}
