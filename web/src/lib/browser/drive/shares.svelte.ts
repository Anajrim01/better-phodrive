import type { ShareSummary } from '@madkarmaa/phodrive-core/models';
import { listShares, revokeShare } from '#browser/shares';

export class DriveShares {
    shares = $state<ShareSummary[]>([]);
    loading = $state(false);
    revoking = $state('');
    error = $state('');
    private latestLoad = 0;

    constructor(private readonly feedback: (message: string) => void) {}

    async load() {
        const request = ++this.latestLoad;
        this.loading = true;
        this.error = '';

        const result = await listShares();
        if (request !== this.latestLoad) return;

        this.loading = false;
        result.match({
            Ok: (items) => {
                this.shares = items;
            },
            Err: (failure) => {
                this.error = failure.message;
            }
        });
    }

    async revoke(id: string) {
        this.revoking = id;
        const result = await revokeShare(id);
        this.revoking = '';

        result.match({
            Ok: () => {
                this.shares = this.shares.filter((current) => current.id !== id);
                this.reloadIfLoading();
                this.feedback('Share revoked.');
            },
            Err: (failure) => this.feedback(failure.message)
        });
    }

    add(share: ShareSummary) {
        this.shares = [share, ...this.shares.filter((current) => current.id !== share.id)];
        this.reloadIfLoading();
    }

    // A list requested before this change may predate it, so only a new read can replace the rows.
    private reloadIfLoading() {
        if (this.loading) void this.load();
    }

    publicUrl(share: ShareSummary): string {
        return new URL(share.publicPath, window.location.origin).toString();
    }

    async copy(share: ShareSummary) {
        try {
            await navigator.clipboard.writeText(this.publicUrl(share));
            this.feedback('Link copied.');
        } catch {
            this.feedback('Could not copy the link.');
        }
    }
}
