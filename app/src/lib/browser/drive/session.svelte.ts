export type SessionDeps = {
    busy: () => boolean;
    fileAction: () => boolean;
    resetLibrary: () => void;
    loadLibrary: () => void;
    resetUploads: () => void;
    clearConfirmation: () => void;
    clearFeedback: () => void;
    matches: (email: string, token: string) => boolean;
};

export class DriveSession {
    private pending = false;

    constructor(private readonly deps: SessionDeps) {}

    reset(): void {
        this.deps.clearConfirmation();
        this.deps.resetLibrary();

        if (this.deps.busy() || this.deps.fileAction()) {
            this.pending = true;

            return;
        }

        this.pending = false;
        this.deps.resetUploads();
        this.deps.clearFeedback();
        this.deps.loadLibrary();
    }

    reload(email: string, token: string): void {
        if (this.pending || !this.deps.matches(email, token)) this.reset();
    }
}
