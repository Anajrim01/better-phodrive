import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { FolderHistory, type FolderOpenMode } from '#browser/drive/folder-history';

const TRAVERSAL_TIMEOUT_MS = 1_000;
const TRAVERSAL_EXPIRY_MS = 30_000;

type FolderNavigationDeps = {
    folder: () => string;
    setFolder: (folder: string) => void;
    files: () => readonly FileGroup[];
};

export function folderExists(files: readonly FileGroup[], path: string): boolean {
    const prefix = `${path}/`;

    return files.some((file) => file.folder === path || file.folder.startsWith(prefix));
}

export class FolderNavigation {
    private readonly history = new FolderHistory((folder) => this.follow(folder));
    private initial = true;
    private pending: string | null;
    private startup = true;
    private traversing = false;
    private traversalTimer: ReturnType<typeof setTimeout> | undefined;
    private traversalExpiryTimer: ReturnType<typeof setTimeout> | undefined;
    private hasMore = true;
    private navigationVersion = 0;
    private traversal: { target: string; version: number } | null = null;

    constructor(private readonly deps: FolderNavigationDeps) {
        this.pending = this.history.start();
    }

    hasOrPending = (path: string): boolean => {
        if (this.initial && this.pending === path) return true;

        return folderExists(this.deps.files(), path);
    };

    open(path: string, mode: FolderOpenMode = 'push'): void {
        if (this.traversing) return;

        const current = this.deps.folder();
        if (path && !folderExists(this.deps.files(), path)) return;
        if (path === current) return;

        if (this.initial) {
            this.initial = false;
            this.pending = null;
        }

        if (mode === 'ancestor' && this.history.navigate(path, current)) {
            this.clearTraversal();
            this.navigationVersion += 1;
            const version = this.navigationVersion;
            this.traversal = { target: path, version };
            this.traversing = true;
            this.traversalTimer = setTimeout(() => {
                this.traversing = false;
            }, TRAVERSAL_TIMEOUT_MS);
            this.traversalExpiryTimer = setTimeout(() => {
                if (this.traversal?.version === version) this.traversal = null;
            }, TRAVERSAL_EXPIRY_MS);

            return;
        }

        this.navigationVersion += 1;
        this.deps.setFolder(path);
        if (mode !== 'ancestor') this.history.open(path, current, mode);
    }

    reset(): void {
        this.deps.setFolder('');
        this.navigationVersion += 1;
        this.hasMore = true;
        this.clearTraversal();
        if (this.startup && this.initial) {
            this.startup = false;

            return;
        }

        this.startup = false;
        this.initial = false;
        this.pending = null;
        this.history.reset();
    }

    settle(hasMore: boolean): void {
        this.hasMore = hasMore;
        if (!this.initial) {
            if (!this.deps.folder()) this.history.reset();

            return;
        }

        const path = this.pending ?? '';
        if (path && folderExists(this.deps.files(), path)) {
            this.settleTo(path);

            return;
        }
        if (path && hasMore) {
            this.deps.setFolder(path);

            return;
        }

        this.settleTo('');
    }

    private settleTo(path: string): void {
        this.initial = false;
        this.pending = null;
        this.deps.setFolder(path);
        this.history.restore(path);
    }

    private stopTraversal(): void {
        clearTimeout(this.traversalTimer);
        this.traversing = false;
    }

    private clearTraversal(): void {
        clearTimeout(this.traversalTimer);
        clearTimeout(this.traversalExpiryTimer);
        this.traversing = false;
        this.traversal = null;
    }

    private follow(folder: string): void {
        const traversal = this.traversal;
        this.stopTraversal();
        if (traversal && folder === traversal.target) {
            this.clearTraversal();
            if (traversal.version !== this.navigationVersion) {
                this.history.restore(this.deps.folder());

                return;
            }
        } else if (traversal) {
            this.navigationVersion += 1;
        }

        if (this.initial) {
            if (folder === this.pending) {
                this.settle(this.hasMore);

                return;
            }

            this.initial = false;
            this.pending = null;
        }

        if (folder && !folderExists(this.deps.files(), folder)) {
            if (this.hasMore) {
                this.initial = true;
                this.pending = folder;
                this.deps.setFolder(folder);

                return;
            }

            this.deps.setFolder('');
            this.history.restore('');

            return;
        }

        this.deps.setFolder(folder);
    }
}
