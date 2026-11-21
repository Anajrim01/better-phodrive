import type { PublicShare, ShareFile } from '@madkarmaa/phodrive-core/models';
import { getPublicShare } from './shares';
import { downloadShareFile, offerShareDownload, pickShareDownloadTarget } from './share-download';

export class PublicShareViewer {
    manifest = $state<PublicShare | null>(null);
    loading = $state(true);
    error = $state('');
    folder = $state('');
    downloading = $state('');
    downloadError = $state('');
    progress = $state({ done: 0, total: 0 });
    private token = '';
    private manifestRequest: AbortController | null = null;
    private downloadRequest: AbortController | null = null;

    async load(token: string) {
        this.dispose();
        this.token = token;
        const active = new AbortController();
        this.manifestRequest = active;
        this.manifest = null;
        this.loading = true;
        this.error = '';
        this.folder = '';
        this.downloadError = '';
        this.progress = { done: 0, total: 0 };

        const result = await getPublicShare(token, active.signal);
        if (active.signal.aborted) return;

        this.loading = false;
        result.match({
            Ok: (share) => {
                this.manifest = share;
            },
            Err: (failure) => {
                this.error = failure.message;
            }
        });
    }

    async download(file: ShareFile) {
        if (this.downloading) return;

        const active = new AbortController();
        const token = this.token;
        this.downloadRequest = active;
        this.downloading = file.id;
        this.downloadError = '';
        this.progress = { done: 0, total: file.chunkCount };

        try {
            const picked = await pickShareDownloadTarget(file.name);
            if (active.signal.aborted) return;

            await picked.match<void | Promise<void>>({
                Err: (failure) => {
                    this.downloadError = failure.message;
                },
                Ok: async (target) => {
                    if (target.kind === 'cancelled') return;

                    const result = await downloadShareFile(token, file, {
                        target,
                        signal: active.signal,
                        onProgress: (done, total) => {
                            if (!active.signal.aborted) this.progress = { done, total };
                        }
                    });

                    await result.match<void | Promise<void>>({
                        Ok: async (outcome) => {
                            if (active.signal.aborted) {
                                if (outcome.kind === 'file') await outcome.release();
                                return;
                            }
                            offerShareDownload(outcome, file.name);
                        },
                        Err: (failure) => {
                            if (!active.signal.aborted) this.downloadError = failure.message;
                        }
                    });
                }
            });
        } finally {
            if (this.downloadRequest === active) {
                this.downloadRequest = null;
                this.downloading = '';
            }
        }
    }

    dispose() {
        this.manifestRequest?.abort();
        this.downloadRequest?.abort();
        this.manifestRequest = null;
        this.downloadRequest = null;
        this.downloading = '';
    }
}
