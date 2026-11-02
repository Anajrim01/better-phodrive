const FOLDER_PARAM = 'folder';

type FolderHistoryState = { folder?: unknown; trail?: unknown };

let cleanup: (() => void) | null = null;

export type FolderOpenMode = 'push' | 'replace' | 'ancestor';

function historyAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.history && !!window.location;
}

function readState(state: unknown): { folder: string | null; trail: string[] } {
    if (typeof state !== 'object' || state === null) return { folder: null, trail: [] };

    const { folder, trail } = state as FolderHistoryState;
    const validTrail = Array.isArray(trail)
        ? trail.filter((item): item is string => typeof item === 'string')
        : [];

    return { folder: typeof folder === 'string' ? folder : null, trail: validTrail };
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

export function resetFolderHistory(): void {
    if (!historyAvailable()) return;

    window.history.replaceState({ folder: '', trail: [''] }, '', folderUrl(''));
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

        this.replace(folder, this.trailFor(folder));
    }

    open(folder: string, current: string, mode: Exclude<FolderOpenMode, 'ancestor'>): void {
        if (!historyAvailable() || folder === current) return;

        const trail = this.trailFor(current);
        if (mode === 'replace') this.replace(folder, [...trail.slice(0, -1), folder]);
        else this.push(folder, [...trail, folder]);
    }

    navigate(folder: string, current: string): boolean {
        if (!historyAvailable() || folder === current) return false;

        const trail = this.trailFor(current);
        const index = trail.lastIndexOf(folder);
        if (index >= 0 && index < trail.length - 1) {
            window.history.go(index - (trail.length - 1));

            return true;
        }

        this.replace(folder, [...trail.slice(0, -1), folder]);

        return false;
    }

    reset(): void {
        resetFolderHistory();
    }

    private trailFor(folder: string): string[] {
        const state = readState(window.history.state);
        if (state.trail.length && state.trail.at(-1) === folder) return state.trail;

        return [folder];
    }

    private push(folder: string, trail: string[]): void {
        window.history.pushState({ folder, trail }, '', folderUrl(folder));
    }

    private replace(folder: string, trail: string[]): void {
        window.history.replaceState({ folder, trail }, '', folderUrl(folder));
    }

    private readonly receive = (event: PopStateEvent): void => {
        const state = readState(event.state);
        this.onFolder(state.folder ?? folderFromUrl(window.location.href));
    };
}
