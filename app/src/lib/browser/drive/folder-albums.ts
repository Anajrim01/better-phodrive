import { MAX_ALBUM_BATCH_SIZE } from '@madkarmaa/phodrive-core/models';
import { groupChunks, type UploadedChunk } from '@madkarmaa/phodrive-core/files';
import { assignFolderAlbum } from '@madkarmaa/phodrive-core/browser/albums';
import type { BrowserPreferences } from '#browser/storage';

export async function addFilesToFolderAlbums(
    preferences: BrowserPreferences,
    email: string,
    token: string,
    chunks: readonly UploadedChunk[],
    feedback: (message: string) => void
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
            const knownKey = preferences.albumKey(email, folder);
            let assigned = await assignFolderAlbum(email, token, folder, knownKey, batch);

            if (assigned.isErr() && knownKey !== undefined)
                assigned = await assignFolderAlbum(email, token, folder, undefined, batch);

            assigned.match({
                Ok: (albumKey) => {
                    preferences.saveAlbumKey(email, folder, albumKey).inspectErr((error) => {
                        feedback(error.message);
                    });
                },
                Err: (error) => {
                    feedback(
                        `Files uploaded. Could not add them to the ${folder} album. ${error.message}`
                    );
                }
            });
        }
    }
}
