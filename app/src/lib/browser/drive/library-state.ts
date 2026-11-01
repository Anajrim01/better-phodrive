import type { GroupLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { nextRetryAt } from '#browser/drive/group-target';

export type LibraryState = {
    chunks: UploadedChunk[];
    accounts: GroupAccountState[];
    partial: boolean;
    nextPageToken: string;
    loadedPages: number;
    loadFailed: boolean;
    retryAt: number;
    folder: string;
};

export function reportLoadFailure(
    state: Pick<LibraryState, 'loadFailed' | 'retryAt'>,
    error: ApplicationError,
    feedback: (message: string) => void
): void {
    state.loadFailed = true;
    if (error.code === 'THROTTLED') state.retryAt = Date.now() + error.retryAfterSeconds * 1_000;
    feedback(error.message);
}

export function applyGroupSnapshot(
    state: LibraryState,
    snapshot: GroupLibrarySnapshot,
    onAccounts: (accounts: GroupAccountState[]) => void,
    hasFolder: (path: string) => boolean
): void {
    state.loadFailed = false;
    state.chunks = snapshot.chunks;
    state.accounts = snapshot.accounts;
    state.partial = snapshot.partial;
    state.nextPageToken = '';
    state.loadedPages = 1;
    onAccounts(snapshot.accounts);
    state.retryAt = nextRetryAt(snapshot.accounts);
    if (state.folder && !hasFolder(state.folder)) state.folder = '';
}
