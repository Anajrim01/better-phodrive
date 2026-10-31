import { addFolderAlbums } from '@madkarmaa/phodrive-core/albums';
import { assignFolderAlbum } from '@madkarmaa/phodrive-core/browser/albums';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';
import type { BrowserPreferences } from '#browser/storage';

export async function addFilesToFolderAlbums(
    preferences: BrowserPreferences,
    email: string,
    token: string,
    chunks: readonly UploadedChunk[],
    feedback: (message: string) => void
): Promise<void> {
    await addFolderAlbums(
        chunks,
        (folder) => preferences.albumKey(email, folder),
        (folder, key) => {
            preferences.saveAlbumKey(email, folder, key).inspectErr((error) => {
                feedback(error.message);
            });
        },
        (folder, key, mediaKeys) => assignFolderAlbum(email, token, folder, key, mediaKeys),
        (folder, message) => {
            feedback(`Files uploaded. Could not add them to the ${folder} album. ${message}`);
        }
    );
}
