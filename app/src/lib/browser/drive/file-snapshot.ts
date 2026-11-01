import type { FileGroup } from '@madkarmaa/phodrive-core/files';

export const FILE_CHANGED_MESSAGE =
    'This file changed while you were confirming. Refresh and try again.';

export function fileChangedSince(
    snapshot: FileGroup,
    current: FileGroup | undefined,
    owner: string
): boolean {
    if (
        snapshot.email !== owner ||
        !current ||
        current.name !== snapshot.name ||
        current.chunks.length !== snapshot.chunks.length
    )
        return true;

    return current.chunks.some(
        (chunk) =>
            !snapshot.chunks.some(
                (saved) =>
                    saved.mediaKey === chunk.mediaKey &&
                    saved.sha1 === chunk.sha1 &&
                    saved.chunkIndex === chunk.chunkIndex
            )
    );
}
