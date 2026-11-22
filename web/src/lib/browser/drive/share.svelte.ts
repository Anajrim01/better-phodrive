import type { CreateShareRequest, ShareSummary } from '@madkarmaa/phodrive-core/models';
import type { FileGroup } from '@madkarmaa/phodrive-core/file-groups';
import { createShareRequest } from '#browser/shares';
import type { DriveContext } from '#browser/drive/context.svelte';
import { DriveShares } from '#browser/drive/shares.svelte';

export type ShareTarget =
    | { kind: 'file'; name: string; item: FileGroup }
    | { kind: 'folder'; name: string; folder: string };

export class DriveShareController {
    target = $state<ShareTarget | null>(null);
    busy = $state(false);
    error = $state('');
    result = $state<ShareSummary | null>(null);
    readonly shares: DriveShares;
    private requestKey = '';

    constructor(
        private readonly context: () => DriveContext | null,
        private readonly disabled: () => boolean,
        private readonly feedback: (message: string) => void
    ) {
        this.shares = new DriveShares(feedback);
    }

    requestFile(item: FileGroup) {
        if (this.disabled() || this.busy) return;
        if (!item.complete || item.trashed || item.trashedChunks?.length) {
            this.feedback('Only complete active files can be shared.');

            return;
        }

        this.target = { kind: 'file', name: item.name, item };
        this.requestKey = crypto.randomUUID();
        this.result = null;
        this.error = '';
    }

    requestFolder(path: string) {
        if (this.disabled() || this.busy || !path) return;

        this.target = {
            kind: 'folder',
            name: path.split('/').filter(Boolean).at(-1) ?? 'Folder',
            folder: path
        };
        this.requestKey = crypto.randomUUID();
        this.result = null;
        this.error = '';
    }

    close() {
        if (this.busy) return;

        this.target = null;
        this.requestKey = '';
        this.result = null;
        this.error = '';
    }

    async create(name: string) {
        const target = this.target;
        const current = this.context();
        if (!target || !current || this.busy) return;

        const shareName = name.trim();
        if (!shareName) {
            this.error = 'Enter a share name.';

            return;
        }

        this.busy = true;
        this.error = '';
        const requestKey = this.requestKey || (this.requestKey = crypto.randomUUID());
        const context =
            current.kind === 'account'
                ? ({ kind: 'account', id: current.account.id } as const)
                : ({ kind: 'group', id: current.group.id } as const);
        const base = { requestKey, name: shareName, context };
        let input: CreateShareRequest;
        if (target.kind === 'folder') {
            input = { ...base, kind: 'folder', folder: target.folder };
        } else {
            const accountId =
                target.item.accountId ??
                (current.kind === 'account' ? current.account.id : undefined);
            if (!accountId) {
                this.busy = false;
                this.error = 'The file owner account is missing.';

                return;
            }

            input = { ...base, kind: 'file', accountId, fileId: target.item.fileId };
        }

        try {
            const result = await createShareRequest(input);

            result.match({
                Ok: (share) => {
                    if (share.status === 'revoked') {
                        this.error =
                            'This share was revoked. Close this dialog and start a new share.';

                        return;
                    }

                    this.result = share;
                    this.shares.add(share);
                },
                Err: (failure) => {
                    this.error = failure.message;
                }
            });
        } finally {
            this.busy = false;
        }
    }
}
