const FOLDER_PARAM = 'folder';

type FolderHistoryState = { folder?: unknown };

let cleanup: (() => void) | null = null;

export type FolderOpenMode = 'push' | 'replace' | 'ancestor';

function historyAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.history && !!window.location;
}

function folderFromState(state: unknown): string | null {
    if (typeof state !== 'object' || state === null) return null;

    const folder = (state as FolderHistoryState).folder;

    return typeof folder === 'string' ? folder : null;
}

function folderUrl(folder: string): string {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.delete(FOLDER_PARAM);
    const query = params.toString();
    const folderQuery = folder ? `${FOLDER_PARAM}=${encodeURIComponent(folder)}` : '';
    url.search = [query, folderQuery].filter(Boolean).join('&');

    return `${url.pathname}${url.search}${url.hash}`;
}

export function folderFromUrl(url: string): string {
    return new URL(url).searchParams.get(FOLDER_PARAM) ?? '';
}

export class FolderHistory {
    constructor(private readonly onFolder: (folder: string) => void) {}

    start(): string {
        if (!historyAvailable()) return '';

        cleanup?.();
        window.addEventListener('popstate', this.receive);
        cleanup = () => window.removeEventListener('popstate', this.receive);

        return folderFromUrl(window.location.href);
    }

    restore(folder: string): void {
        if (!historyAvailable()) return;

        this.replace(folder);
    }

    open(folder: string, current: string, mode: Exclude<FolderOpenMode, 'ancestor'>): void {
        if (!historyAvailable() || folder === current) return;

        if (mode === 'replace') this.replace(folder);
        else this.push(folder);
    }

    reset(): void {
        if (!historyAvailable()) return;

        this.replace('');
    }

    private push(folder: string): void {
        window.history.pushState({ folder }, '', folderUrl(folder));
    }

    private replace(folder: string): void {
        window.history.replaceState({ folder }, '', folderUrl(folder));
    }

    private readonly receive = (event: PopStateEvent): void => {
        this.onFolder(folderFromState(event.state) ?? folderFromUrl(window.location.href));
    };
}
