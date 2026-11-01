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
    revisions: Map<string, number>;
};

export function resetLibraryPages(
    state: Pick<LibraryState, 'nextPageToken' | 'loadedPages' | 'loadFailed' | 'revisions'>,
    pageTokens: Set<string>
): void {
    state.nextPageToken = '';
    state.loadedPages = 0;
    state.loadFailed = false;
    state.revisions.clear();
    pageTokens.clear();
}

export function applyLibrarySync(
    state: Pick<
        LibraryState,
        | 'chunks'
        | 'nextPageToken'
        | 'loadedPages'
        | 'revisions'
        | 'loadFailed'
        | 'retryAt'
        | 'folder'
    >,
    email: string,
    update: {
        items: readonly RemoteBmp[];
        deleted: readonly string[];
        full: boolean;
        revision: number;
    },
    pageTokens: Set<string>,
    hasFolder: (path: string) => boolean
): void {
    state.revisions.set(email.toLowerCase(), update.revision);
    state.loadFailed = false;
    state.retryAt = 0;

    if (update.full) {
        state.chunks = update.items.map((item) => ({ ...item, email }));
        state.nextPageToken = '';
        state.loadedPages = 1;
        pageTokens.clear();
    } else {
        state.chunks = applyLibraryDelta(state.chunks, email, update);
    }

    if (state.folder && !hasFolder(state.folder)) state.folder = '';
}

export function applyLibrarySnapshot(
    state: Pick<
        LibraryState,
        | 'chunks'
        | 'nextPageToken'
        | 'loadedPages'
        | 'loadFailed'
        | 'retryAt'
        | 'folder'
        | 'revisions'
    >,
    email: string,
    snapshot: {
        items: readonly RemoteBmp[];
        nextPageToken: string;
        pages: number;
        revision?: number;
    },
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
    if (snapshot.revision !== undefined)
        state.revisions.set(email.toLowerCase(), snapshot.revision);
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
    for (const [email, revision] of Object.entries(snapshot.revisions ?? {})) {
        state.revisions.set(email.toLowerCase(), revision);
    }
    if (state.folder && !hasFolder(state.folder)) state.folder = '';
}
