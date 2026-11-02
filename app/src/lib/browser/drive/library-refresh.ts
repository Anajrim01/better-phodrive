import {
    readGroupLibrary,
    readGroupLibraryUpdates,
    readLibrarySnapshot,
    readLibrarySync
} from '@madkarmaa/phodrive-core/browser/library';
import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';
import {
    applyGroupSnapshot,
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

export async function refreshLibrary(
    state: LibraryState,
    email: string,
    token: string,
    cursor: number,
    pageTokens: Set<string>,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<void> {
    if (cursor > 0) {
        const synced = await readLibrarySync(email, token, false, cursor);
        if (!isCurrent()) return;

        const applied = synced.match({
            Ok: (update) => {
                applyLibrarySync(state, email, update, pageTokens, hasFolder);

                return true;
            },
            Err: () => false
        });
        if (applied) return;
    }

    const refreshed = await readLibrarySnapshot(email, token, state.loadedPages);
    if (!isCurrent()) return;

    refreshed.match({
        Ok: (snapshot) => applyLibrarySnapshot(state, email, snapshot, pageTokens, hasFolder),
        Err: (error) => reportLoadFailure(state, error, feedback)
    });
}

export async function refreshGroupLibrary(
    state: LibraryState,
    group: GroupSelection,
    onAccounts: (accounts: GroupAccountState[]) => void,
    hasFolder: (path: string) => boolean,
    feedback: (message: string) => void,
    isCurrent: () => boolean
): Promise<void> {
    const loaded = await readGroupLibraryUpdates(
        group.members,
        group.missing,
        state.chunks,
        state.accounts,
        state.revisions
    );
    if (!isCurrent()) return;

    const applied = loaded.match({
        Ok: (snapshot) => {
            applyGroupSnapshot(state, snapshot, onAccounts, hasFolder);

            return true;
        },
        Err: () => false
    });
    if (applied) return;

    const fallback = await readGroupLibrary(group.members, group.missing);
    if (!isCurrent()) return;

    fallback.match({
        Ok: (snapshot) => applyGroupSnapshot(state, snapshot, onAccounts, hasFolder),
        Err: (error) => reportLoadFailure(state, error, feedback)
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
): Promise<void> {
    if (reset) {
        state.chunks = [];
        resetLibraryPages(state, pageTokens);
        state.accounts = [];
        state.partial = false;
    }

    state.loading = true;
    feedback('');

    const loaded = await readGroupLibrary(group.members, group.missing);
    if (!isCurrent()) return;

    loaded.match({
        Ok: (snapshot) => applyGroupSnapshot(state, snapshot, onAccounts, hasFolder),
        Err: (error) => reportLoadFailure(state, error, feedback)
    });
}
