const FOLDER_PARAM = 'folder';

type FolderHistoryState = {
    folder?: unknown;
    trail?: unknown;
    generation?: unknown;
    index?: unknown;
};

type ParsedFolderState = {
    folder: string | null;
    trail: string[];
    generation: number;
    index: number;
};

let cleanup: (() => void) | null = null;

export type FolderOpenMode = 'push' | 'replace' | 'ancestor';

function historyAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.history && !!window.location;
}

function readState(state: unknown): ParsedFolderState {
    if (typeof state !== 'object' || state === null)
        return { folder: null, trail: [], generation: 0, index: 0 };

    const { folder, trail, generation, index } = state as FolderHistoryState;
    const validTrail = Array.isArray(trail)
        ? trail.filter((item): item is string => typeof item === 'string')
        : [];

    return {
        folder: typeof folder === 'string' ? folder : null,
        trail: validTrail,
        generation: typeof generation === 'number' ? generation : 0,
        index: typeof index === 'number' ? index : 0
    };
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
    private generation = 0;
    private index = 0;
    private current = '';

    constructor(private readonly onFolder: (folder: string) => void) {}

    start(): string {
        if (!historyAvailable()) return '';

        cleanup?.();
        window.addEventListener('popstate', this.receive);
        cleanup = () => window.removeEventListener('popstate', this.receive);

        const state = readState(window.history.state);
        this.current = folderFromUrl(window.location.href);
        this.generation = state.generation;
        this.index = state.index;

        return this.current;
    }

    restore(folder: string): void {
        if (!historyAvailable()) return;

        this.current = folder;
        this.replace(folder, this.trailFor(folder), this.generation, this.index);
    }

    open(folder: string, current: string, mode: Exclude<FolderOpenMode, 'ancestor'>): void {
        if (!historyAvailable() || folder === current) return;

        const trail = this.trailFor(current);
        this.current = folder;
        if (mode === 'replace') {
            this.generation += 1;
            this.replace(folder, [...trail.slice(0, -1), folder], this.generation, this.index);

            return;
        }

        this.index += 1;
        this.push(folder, [...trail, folder], this.generation, this.index);
    }

    navigate(folder: string, current: string): boolean {
        if (!historyAvailable() || folder === current) return false;

        const trail = this.trailFor(current);
        const index = trail.lastIndexOf(folder);
        if (index >= 0 && index < trail.length - 1) {
            window.history.go(index - (trail.length - 1));

            return true;
        }

        this.current = folder;
        this.generation += 1;
        this.replace(folder, [...trail.slice(0, -1), folder], this.generation, this.index);

        return false;
    }

    reset(): void {
        if (!historyAvailable()) return;

        this.current = '';
        this.generation += 1;
        this.replace('', [''], this.generation, this.index);
    }

    private trailFor(folder: string): string[] {
        const state = readState(window.history.state);
        if (state.trail.length && state.trail.at(-1) === folder) return state.trail;

        return [folder];
    }

    private push(folder: string, trail: string[], generation: number, index: number): void {
        window.history.pushState({ folder, trail, generation, index }, '', folderUrl(folder));
    }

    private replace(folder: string, trail: string[], generation: number, index: number): void {
        window.history.replaceState({ folder, trail, generation, index }, '', folderUrl(folder));
    }

    private readonly receive = (event: PopStateEvent): void => {
        const state = readState(event.state);
        const folder = state.folder ?? folderFromUrl(window.location.href);
        if (state.index > this.index && state.generation < this.generation) {
            const trail =
                this.current && this.current !== folder ? [this.current, folder] : [folder];
            this.generation += 1;
            this.replace(folder, trail, this.generation, state.index);
        } else {
            this.generation = Math.max(this.generation, state.generation);
        }

        this.index = state.index;
        this.current = folder;
        this.onFolder(folder);
    };
}
