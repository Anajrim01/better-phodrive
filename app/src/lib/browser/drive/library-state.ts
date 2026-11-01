import {
    applyLibraryDelta,
    type GroupLibrarySnapshot
} from '@madkarmaa/phodrive-core/browser/library';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
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

export function resetLibraryPages(
    state: Pick<LibraryState, 'nextPageToken' | 'loadedPages' | 'loadFailed'>,
    pageTokens: Set<string>
): void {
    state.nextPageToken = '';
    state.loadedPages = 0;
    state.loadFailed = false;
    pageTokens.clear();
}

export function applyLibrarySync(
    state: Pick<LibraryState, 'chunks' | 'nextPageToken' | 'loadedPages'>,
    email: string,
    update: { items: readonly RemoteBmp[]; deleted: readonly string[]; full: boolean }
): Pick<LibraryState, 'chunks' | 'nextPageToken' | 'loadedPages'> {
    if (update.full)
        return {
            chunks: update.items.map((item) => ({ ...item, email })),
            nextPageToken: '',
            loadedPages: 1
        };

    return {
        chunks: applyLibraryDelta(state.chunks, email, update),
        nextPageToken: state.nextPageToken,
        loadedPages: state.loadedPages
    };
}

export function applyLibrarySnapshot(
    state: Pick<
        LibraryState,
        'chunks' | 'nextPageToken' | 'loadedPages' | 'loadFailed' | 'retryAt' | 'folder'
    >,
    email: string,
    snapshot: { items: readonly RemoteBmp[]; nextPageToken: string; pages: number },
    pageTokens: Set<string>,
    hasFolder: (path: string) => boolean
): void {
    state.loadFailed = false;
    state.retryAt = 0;
    state.chunks = snapshot.items.map((item) => ({ ...item, email }));
    state.nextPageToken = snapshot.nextPageToken;
    state.loadedPages = snapshot.pages;
    pageTokens.clear();
    if (snapshot.nextPageToken) pageTokens.add(snapshot.nextPageToken);
    if (state.folder && !hasFolder(state.folder)) state.folder = '';
}

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
