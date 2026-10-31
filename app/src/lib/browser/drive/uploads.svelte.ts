import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { createUploadJobs, uploadFiles, type UploadJob } from '#browser/files';
import type { BrowserPreferences } from '#browser/storage';
import { addFilesToFolderAlbums } from '#browser/drive/folder-albums';

export type UploadDeps = {
    account: () => { email: string; token: string | undefined };
    folder: () => string;
    workers: () => number;
    loading: () => boolean;
    blocked: () => boolean;
    preferences: () => BrowserPreferences | null;
    feedback: (message: string) => void;
    onChunk: (chunk: UploadedChunk) => void;
    afterUpload: () => void;
    reload: (email: string, token: string) => void;
};

export class DriveUploads {
    busy = $state(false);
    panelOpen = $state(false);
    jobs = $state<UploadJob[]>([]);
    private sources: readonly File[] = [];
    private folders = new Map<number, string>();

    constructor(private readonly deps: UploadDeps) {}

    reset(): void {
        this.jobs = [];
        this.sources = [];
        this.folders.clear();
        this.panelOpen = false;
        this.busy = false;
    }

    async upload(files: readonly File[]): Promise<void> {
        const { email } = this.deps.account();
        if (this.busy || this.deps.blocked() || !email || files.length === 0) return;

        if (this.deps.loading()) {
            this.deps.feedback(
                'Files are refreshing. Wait for the refresh to finish, then select your files again.'
            );

            return;
        }

        this.sources = [...files];
        this.jobs = createUploadJobs(files);
        this.folders = new Map(files.map((_, index) => [index, this.deps.folder()]));
        await this.run(files);
    }

    async retry(id: number): Promise<void> {
        const job = this.jobs.find((current) => current.id === id);
        const file = this.sources[id];
        if (!job || job.status !== UploadJobStatus.Error || !file) return;
        if (this.busy || this.deps.blocked() || this.deps.loading()) return;

        const fresh = createUploadJobs([file])[0];
        if (!fresh) return;

        this.jobs = this.jobs.map((current) => (current.id === id ? { ...fresh, id } : current));
        await this.run([file], id, this.folders.get(id) ?? this.deps.folder());
    }

    private async run(
        files: readonly File[],
        retryId?: number,
        folder = this.deps.folder()
    ): Promise<void> {
        const { email, token } = this.deps.account();
        if (!token) return;
        const uploadedChunks: UploadedChunk[] = [];

        this.panelOpen = true;
        this.deps.feedback('');
        this.busy = true;

        const uploaded = await uploadFiles(
            files,
            email,
            token,
            this.deps.workers(),
            (job) => {
                const id = retryId ?? job.id;
                this.jobs = this.jobs.map((current) =>
                    current.id === id ? { ...job, id } : current
                );

                if (job.status === UploadJobStatus.Error) this.deps.feedback(job.message);
            },
            (saved) => {
                uploadedChunks.push(saved);

                if (this.deps.account().email !== email) return;

                this.deps.onChunk(saved);
            },
            { folder }
        );

        uploaded.inspectErr((error) => {
            this.deps.feedback(error.message);
            this.jobs = this.jobs.map((job) =>
                (retryId !== undefined && job.id !== retryId) ||
                job.status === UploadJobStatus.Complete ||
                job.status === UploadJobStatus.Error
                    ? job
                    : { ...job, status: UploadJobStatus.Error, message: error.message }
            );
        });

        const preferences = this.deps.preferences();
        if (preferences)
            await addFilesToFolderAlbums(
                preferences,
                email,
                token,
                uploadedChunks,
                this.deps.feedback
            );
        this.deps.afterUpload();

        this.busy = false;
        this.deps.reload(email, token);
    }
}
