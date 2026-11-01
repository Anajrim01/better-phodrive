import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import type { FileGroup, UploadedChunk } from '@madkarmaa/phodrive-core/files';

export const FILE_CHANGED_MESSAGE =
    'This file changed while you were confirming. Refresh and try again.';

type DestructiveAction = FileActionKind.Delete | FileActionKind.DeleteForever;

function actionChunks(item: FileGroup, action: DestructiveAction): UploadedChunk[] {
    return action === FileActionKind.Delete
        ? [...item.chunks, ...item.duplicates]
        : item.trashedChunks;
}

function sameChunks(first: readonly UploadedChunk[], second: readonly UploadedChunk[]): boolean {
    if (first.length !== second.length) return false;

    return first.every((chunk) =>
        second.some(
            (saved) =>
                saved.mediaKey === chunk.mediaKey &&
                saved.sha1 === chunk.sha1 &&
                saved.chunkIndex === chunk.chunkIndex
        )
    );
}

export function fileChangedSince(
    snapshot: FileGroup,
    current: FileGroup | undefined,
    owner: string,
    action: DestructiveAction
): boolean {
    if (
        snapshot.email !== owner ||
        !current ||
        snapshot.trashed !== current.trashed ||
        snapshot.complete !== current.complete ||
        snapshot.name !== current.name
    )
        return true;

    const snapshotChunks = actionChunks(snapshot, action);
    const currentChunks = actionChunks(current, action);

    return !sameChunks(snapshotChunks, currentChunks) || !sameChunks(currentChunks, snapshotChunks);
}
