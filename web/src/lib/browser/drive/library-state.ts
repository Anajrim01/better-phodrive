import type { GoogleAccountSummary, LibraryWarning } from '@madkarmaa/phodrive-core/models';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { DriveContext } from '#browser/drive/context.svelte';

export type AccountCursor = {
    account: GoogleAccountSummary;
    pageToken: string;
    loadedPages: number;
    pageTokens: Set<string>;
};

export type MemberFailure = { account: GoogleAccountSummary; message: string };

export function libraryMembers(context: DriveContext | null): GoogleAccountSummary[] {
    if (!context) return [];

    return context.kind === 'account' ? [context.account] : context.group.members;
}

export function mergeAccountChunks(
    existing: readonly UploadedChunk[],
    found: readonly UploadedChunk[]
): UploadedChunk[] {
    const chunks = new Map(existing.map((chunk) => [chunk.mediaKey, chunk]));
    for (const chunk of found) chunks.set(chunk.mediaKey, chunk);

    return [...chunks.values()];
}

export function cursorFor(
    cursors: Map<string, AccountCursor>,
    account: GoogleAccountSummary
): AccountCursor {
    const current = cursors.get(account.id);
    if (current) return current;

    const created: AccountCursor = {
        account,
        pageToken: '',
        loadedPages: 0,
        pageTokens: new Set()
    };
    cursors.set(account.id, created);

    return created;
}

export function pruneCursors(
    cursors: Map<string, AccountCursor>,
    chunksByAccount: Map<string, UploadedChunk[]>,
    members: readonly GoogleAccountSummary[]
) {
    const ids = new Set(members.map((account) => account.id));

    for (const id of cursors.keys())
        if (!ids.has(id)) {
            cursors.delete(id);
            chunksByAccount.delete(id);
        }
}

export function hasMore(cursors: Map<string, AccountCursor>): boolean {
    return [...cursors.values()].some((cursor) => cursor.pageToken !== '');
}

export function flattenChunks(chunksByAccount: Map<string, UploadedChunk[]>): UploadedChunk[] {
    return [...chunksByAccount.values()].flat();
}

export function failureMessage(
    members: readonly GoogleAccountSummary[],
    failures: readonly MemberFailure[]
): string | null {
    const [first] = failures;
    if (!first) return null;

    return members.length > 1
        ? `Could not load ${first.account.email}: ${first.message}`
        : first.message;
}

/** Metadata and parse failures degrade the index, not the already-valid Google results. */
export function warningMessage(warnings: readonly LibraryWarning[]): string | null {
    const codes = new Set(warnings.map((warning) => warning.code));
    if (codes.has('METADATA_SAVE_FAILED'))
        return 'Files loaded, but Phodrive could not update its metadata index.';
    if (codes.has('METADATA_LOAD_FAILED'))
        return 'Files loaded, but library metadata was unavailable.';
    if (codes.has('ENTRY_PARSE_FAILED')) return 'Some Google Photos items could not be read.';

    return null;
}
