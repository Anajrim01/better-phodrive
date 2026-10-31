import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import { PersistedState } from 'runed';
import { Err, Ok, type Result } from 'results-ts';
import {
    AlbumKeySchema,
    FolderPathSchema,
    StoredAlbumsSchema
} from '@madkarmaa/phodrive-core/models';
import { readState, readStoredJson, writeState } from '#browser/persisted';

export const ALBUMS_KEY = 'phodrive-albums';

type StoredAlbums = Record<string, Record<string, string>>;

const ALBUMS_SERIALIZER = {
    serialize: (albums: StoredAlbums) => JSON.stringify(albums),
    deserialize: (raw: string): StoredAlbums => {
        const parsed = StoredAlbumsSchema.safeParse(readStoredJson(raw));

        return parsed.success ? parsed.data : {};
    }
};

export class AlbumKeys {
    private readonly state = new PersistedState<StoredAlbums>(
        ALBUMS_KEY,
        {},
        {
            serializer: ALBUMS_SERIALIZER
        }
    );

    get(email: string, folder: string): string | undefined {
        const albums: StoredAlbums = readState(this.state).unwrapOr({});
        const parsed = FolderPathSchema.safeParse(folder);
        if (!parsed.success) return undefined;

        const key = albums[email]?.[parsed.data];

        return AlbumKeySchema.safeParse(key).success ? key : undefined;
    }

    save(email: string, folder: string, albumKey: string): Result<void, ApplicationError> {
        const parsedFolder = FolderPathSchema.safeParse(folder);
        const parsedKey = AlbumKeySchema.safeParse(albumKey);
        if (!parsedFolder.success || !parsedKey.success)
            return Err({
                code: 'INVALID_ALBUM_KEY',
                message: 'Could not save the folder album in this browser.'
            } as const);

        const albums: StoredAlbums = readState(this.state).unwrapOr({});
        const account = { ...albums[email], [parsedFolder.data]: parsedKey.data };

        return writeState(this.state, { ...albums, [email]: account });
    }
}
