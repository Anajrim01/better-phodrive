import {
    readGroupLibrary,
    readGroupLibraryUpdates,
    readLibraryPage,
    readLibrarySnapshot,
    readLibrarySync
} from '@madkarmaa/phodrive-core/browser/library';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import {
    applyGroupSnapshot,
    applyLibraryPage,
    applyLibrarySnapshot,
    applyLibrarySync,
    reportLoadFailure,
    resetLibraryPages,
    type LibraryState
} from '#browser/drive/library-state';

type GroupSelection = {
    members: readonly { email: string; token: string; pausedUntil?: number }[];
    missing: readonly string[];
};

export async function loadLibrary(
    state: LibraryState,
    email: string,
    token: string,
    reset: boolean,
    pageTokens: Set<string>,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<boolean> {
    const pageToken = reset ? '' : state.nextPageToken;

    if (reset || pageToken === '') {
        const synced = await readLibrarySync(email, token, false, 0);
        if (!isCurrent()) return false;

        const applied = synced.match({
            Ok: (update) => {
                if (!update.full) return false;

                applyLibrarySync(state, email, update, pageTokens, hasFolder);

                return true;
            },
            Err: () => false
        });
        if (applied) return true;
    }

    const loaded = await readLibraryPage(email, token, pageToken);
    if (!isCurrent()) return false;

    return loaded.match({
        Ok: (page) => {
            applyLibraryPage(state, email, page, reset, pageTokens, feedback);

            return true;
        },
        Err: (error) => {
            reportLoadFailure(state, error, feedback);

            return false;
        }
    });
}

export async function refreshLibrary(
    state: LibraryState,
    email: string,
    token: string,
    cursor: number,
    pageTokens: Set<string>,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<boolean> {
    if (cursor > 0) {
        const synced = await readLibrarySync(email, token, false, cursor);
        if (!isCurrent()) return false;

        const applied = synced.match({
            Ok: (update) => {
                applyLibrarySync(state, email, update, pageTokens, hasFolder);

                return true;
            },
            Err: () => false
        });
        if (applied) return true;
    }

    const refreshed = await readLibrarySnapshot(email, token, state.loadedPages);
    if (!isCurrent()) return false;

    return refreshed.match({
        Ok: (snapshot) => {
            applyLibrarySnapshot(state, email, snapshot, pageTokens, hasFolder);

            return true;
        },
        Err: (error) => {
            reportLoadFailure(state, error, feedback);

            return false;
        }
    });
}

export async function refreshGroupLibrary(
    state: LibraryState,
    group: GroupSelection,
    onAccounts: (accounts: GroupAccountState[]) => void,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<boolean> {
    const loaded = await readGroupLibraryUpdates(
        group.members,
        group.missing,
        state.chunks,
        state.accounts,
        state.revisions
    );
    if (!isCurrent()) return false;

    const applied = loaded.match({
        Ok: (snapshot) => {
            applyGroupSnapshot(state, snapshot, onAccounts, hasFolder);

            return true;
        },
        Err: () => false
    });
    if (applied) return true;

    const fallback = await readGroupLibrary(group.members, group.missing);
    if (!isCurrent()) return false;

    return fallback.match({
        Ok: (snapshot) => {
            applyGroupSnapshot(state, snapshot, onAccounts, hasFolder);

            return true;
        },
        Err: (error) => {
            reportLoadFailure(state, error, feedback);

            return false;
        }
    });
}

export async function loadGroupLibrary(
    state: LibraryState,
    group: GroupSelection,
    reset: boolean,
    pageTokens: Set<string>,
    onAccounts: (accounts: GroupAccountState[]) => void,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<boolean> {
    if (reset) {
        state.chunks = [];
        resetLibraryPages(state, pageTokens);
        state.accounts = [];
        state.partial = false;
    }

    state.loading = true;
    feedback('');

    const loaded = await readGroupLibrary(group.members, group.missing);
    if (!isCurrent()) return false;

    return loaded.match({
        Ok: (snapshot) => {
            applyGroupSnapshot(state, snapshot, onAccounts, hasFolder);

            return true;
        },
        Err: (error) => {
            reportLoadFailure(state, error, feedback);

            return false;
        }
    });
}
