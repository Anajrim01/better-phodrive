import { applyLibraryDelta } from '@madkarmaa/phodrive-core/browser/library';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { nextRevision } from '#browser/drive/manage-files';

type ManageApplyState = {
    chunks: UploadedChunk[];
    revisions: Map<string, number>;
};

export function applyManageItems(
    state: ManageApplyState,
    email: string,
    items: readonly RemoteBmp[],
    revision: number
): void {
    state.chunks = applyLibraryDelta(state.chunks, email, { items, deleted: [] });
    const key = email.toLowerCase();
    const previous = state.revisions.get(key) ?? 0;
    const next = nextRevision(previous, revision);
    if (next !== undefined) state.revisions.set(key, next);
}
