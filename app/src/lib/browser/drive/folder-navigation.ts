import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { FolderHistory, type FolderOpenMode } from '#browser/drive/folder-history';

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
    private hasMore = true;

    constructor(private readonly deps: FolderNavigationDeps) {
        this.pending = this.history.start();
    }

    hasOrPending = (path: string): boolean => {
        if (this.initial && this.pending === path) return true;

        return folderExists(this.deps.files(), path);
    };

    open(path: string, mode: FolderOpenMode = 'push'): void {
        const current = this.deps.folder();
        if (path && !folderExists(this.deps.files(), path)) return;
        if (path === current) return;

        if (this.initial) {
            this.initial = false;
            this.pending = null;
        }

        this.deps.setFolder(path);
        if (mode === 'ancestor') this.history.open(path, current, 'replace');
        else this.history.open(path, current, mode);
    }

    reset(): void {
        this.deps.setFolder('');
        this.hasMore = true;
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

    private follow(folder: string): void {
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
