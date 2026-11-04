import { FileActionKind, type ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { fileKey, type FileGroup } from '@madkarmaa/phodrive-core/files';
import { unchangedFile } from './chunks';
import { deleteForeverFile, downloadAndSave, restoreFile, trashFile } from './actions';
import type { DriveLibrary } from './library.svelte';

export type FileActionContext = {
    library: DriveLibrary;
    processing: ProcessingMode;
    workers: number;
};

/** The freshly loaded group matching a confirmation target, or null if it changed. */
export function confirmedFile(
    library: DriveLibrary,
    item: FileGroup,
    permanent: boolean
): FileGroup | null {
    const source = permanent ? library.trashFiles : library.files;
    const current = source.find((file) => fileKey(file) === fileKey(item));

    return unchangedFile(current, item) ? current : null;
}

/** Run one file action and return its user-facing failure message, if any. */
export async function performFileAction(
    item: FileGroup,
    action: FileActionKind,
    { library, processing, workers }: FileActionContext
): Promise<string> {
    let result;

    switch (action) {
        case FileActionKind.Download:
            result = await downloadAndSave(item, processing);
            break;
        case FileActionKind.Restore:
            result = await restoreFile(library, item, workers);
            break;
        case FileActionKind.DeleteForever:
            result = await deleteForeverFile(library, item, workers);
            break;
        default:
            result = await trashFile(library, item, workers);
    }
    let message = '';
    result.inspectErr((error) => {
        message = error.message;
    });

    return message;
}
