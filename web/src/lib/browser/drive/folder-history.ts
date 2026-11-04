/** Minimal History API adapter, so folder navigation is testable without a DOM. */
import { FolderPathSchema } from '@madkarmaa/phodrive-core/models';

export type FolderHistoryEnv = {
    read: () => string;
    push: (url: string, state: unknown) => void;
    replace: (url: string, state: unknown) => void;
    listen: (handler: (url: string) => void) => () => void;
};

export type FolderOpenMode = 'push' | 'replace' | 'ancestor';

function browserEnv(): FolderHistoryEnv {
    if (typeof window === 'undefined' || !window.history || !window.location)
        return {
            read: () => '',
            push: () => {},
            replace: () => {},
            listen: () => () => {}
        };

    return {
        read: () => window.location.href,
        push: (url, state) => window.history.pushState(state, '', url),
        replace: (url, state) => window.history.replaceState(state, '', url),
        listen: (handler) => {
            const onPop = () => handler(window.location.href);
            window.addEventListener('popstate', onPop);

            return () => window.removeEventListener('popstate', onPop);
        }
    };
}

/** Preserve unrelated query parameters and the hash while replacing the folder parameter. */
export function folderUrl(current: string, folder: string): string {
    const url = new URL(current, 'http://localhost');
    url.searchParams.delete('folder');
    if (folder) url.searchParams.set('folder', folder);

    return `${url.pathname}${url.search}${url.hash}`;
}

export function folderFromUrl(url: string): string {
    const folder = new URL(url, 'http://localhost').searchParams.get('folder') ?? '';

    return folder && FolderPathSchema.safeParse(folder).success ? folder : '';
}

export class FolderHistory {
    private stop: (() => void) | null = null;

    constructor(private readonly env: FolderHistoryEnv = browserEnv()) {}

    start(onFolder: (folder: string) => void): string {
        this.stop?.();
        this.stop = this.env.listen((url) => onFolder(folderFromUrl(url)));

        return folderFromUrl(this.env.read());
    }

    open(folder: string, current: string, mode: FolderOpenMode): void {
        if (folder === current) return;

        const url = folderUrl(this.env.read(), folder);
        if (mode === 'replace' || mode === 'ancestor') this.env.replace(url, { folder });
        else this.env.push(url, { folder });
    }

    restore(folder: string): void {
        this.env.replace(folderUrl(this.env.read(), folder), { folder });
    }

    reset(): void {
        this.restore('');
    }
}
