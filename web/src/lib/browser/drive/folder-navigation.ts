import type { FileGroup } from '@madkarmaa/phodrive-core/files';
import { FolderHistory, type FolderOpenMode } from '#browser/drive/folder-history';

export function folderExists(files: readonly Pick<FileGroup, 'folder'>[], path: string): boolean {
    return files.some((file) => file.folder === path || file.folder.startsWith(`${path}/`));
}

/** Folder display state plus deep-link and back/forward restoration. */
export class FolderNavigation {
    private initial = true;
    private hasMore = true;
    private pending = '';

    constructor(
        private readonly folder: () => string,
        private readonly setFolder: (folder: string) => void,
        private readonly files: () => readonly Pick<FileGroup, 'folder'>[],
        private readonly history = new FolderHistory()
    ) {
        this.pending = this.history.start((path) => this.follow(path));
    }

    has(path: string): boolean {
        if (this.initial && this.hasMore && this.pending === path) return true;

        return folderExists(this.files(), path);
    }

    open(path: string, mode: FolderOpenMode = 'push'): void {
        const current = this.folder();
        if (path && !this.has(path)) return;
        if (path === current) return;

        if (this.initial) {
            this.initial = false;
            this.pending = '';
        }
        this.setFolder(path);
        this.history.open(path, current, mode);
    }

    reset(): void {
        this.initial = false;
        this.pending = '';
        this.hasMore = true;
        this.setFolder('');
        this.history.reset();
    }

    settle(hasMore: boolean): void {
        this.hasMore = hasMore;

        if (!this.initial) {
            if (!this.folder() && this.pending) {
                this.pending = '';
                this.history.restore('');
            }
            this.validate();

            return;
        }

        if (this.pending && this.has(this.pending)) this.settleTo(this.pending);
        else if (this.pending && hasMore) this.setFolder(this.pending);
        else this.settleTo('');
    }

    private settleTo(path: string): void {
        this.initial = false;
        this.pending = '';
        this.setFolder(path);
        this.history.restore(path);
    }

    private follow(path: string): void {
        if (this.initial && path === this.pending) {
            this.settle(this.hasMore);

            return;
        }

        this.initial = false;
        this.pending = '';

        if (path && !folderExists(this.files(), path)) {
            if (this.hasMore) {
                this.initial = true;
                this.pending = path;
                this.setFolder(path);
            } else {
                this.setFolder('');
                this.history.restore('');
            }

            return;
        }

        this.setFolder(path);
    }

    private validate(): void {
        const path = this.folder();
        if (!path || folderExists(this.files(), path)) return;
        if (this.hasMore) return;

        this.setFolder('');
        this.history.restore('');
    }
}
