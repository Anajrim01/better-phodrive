import { MAX_ALBUM_BATCH_SIZE } from './models';
import { groupChunks, type UploadedChunk } from './files';
import type { AsyncResult } from 'results-ts';

export type FolderAlbumError = { message: string };

export async function addFolderAlbums<E extends FolderAlbumError>(
    chunks: readonly UploadedChunk[],
    albumKey: (folder: string) => string | undefined,
    saveAlbumKey: (folder: string, key: string) => void,
    assign: (
        folder: string,
        albumKey: string | undefined,
        mediaKeys: string[]
    ) => AsyncResult<string, E>,
    onError: (folder: string, message: string) => void
): Promise<void> {
    const folders = new Map<string, string[]>();
    for (const file of groupChunks([...chunks])) {
        if (!file.folder || !file.complete) continue;

        const mediaKeys = folders.get(file.folder) ?? [];
        for (const chunk of file.chunks) mediaKeys.push(chunk.mediaKey);
        folders.set(file.folder, mediaKeys);
    }

    for (const [folder, mediaKeys] of folders) {
        for (let index = 0; index < mediaKeys.length; index += MAX_ALBUM_BATCH_SIZE) {
            const batch = mediaKeys.slice(index, index + MAX_ALBUM_BATCH_SIZE);
            const assigned = await assign(folder, albumKey(folder), batch);

            assigned.match({
                Ok: (key) => saveAlbumKey(folder, key),
                Err: (error) => onError(folder, error.message)
            });
        }
    }
}
