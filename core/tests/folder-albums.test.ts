import { expect, test } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import { addFolderAlbums } from '@madkarmaa/phodrive-core/albums';
import type { UploadedChunk } from '@madkarmaa/phodrive-core/files';

const EMAIL = 'test@example.com';

function assigned(key: string): AsyncResult<string, { message: string }> {
    return Ok(undefined).andThenAsync<string, { message: string }>(async () => Ok(key));
}

function failed(message: string): AsyncResult<string, { message: string }> {
    return Ok(undefined).andThenAsync<string, { message: string }>(async () => Err({ message }));
}

function chunk(fileId: string, folder: string, mediaKey: string): UploadedChunk {
    return {
        email: EMAIL,
        folder,
        fileHash: fileId.repeat(64).slice(0, 64),
        fileId: fileId.repeat(64).slice(0, 64),
        chunkIndex: 0,
        isLast: true,
        originalName: `${fileId}.bin`,
        size: 10,
        at: 1,
        mediaKey,
        sha1: fileId.repeat(40).slice(0, 40)
    };
}

test('each folder becomes one album with all of its media keys', async () => {
    const calls: { folder: string; key: string | undefined; mediaKeys: string[] }[] = [];
    const saved: [string, string][] = [];

    await addFolderAlbums(
        [chunk('a', 'photos', 'one'), chunk('b', 'photos', 'two'), chunk('c', 'trips', 'three')],
        () => undefined,
        (folder, key) => saved.push([folder, key]),
        (folder, key, mediaKeys) => {
            calls.push({ folder, key, mediaKeys });

            return assigned(`album-${folder}`);
        },
        () => {}
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
        folder: 'photos',
        key: undefined,
        mediaKeys: ['one', 'two']
    });
    expect(calls[1]).toEqual({ folder: 'trips', key: undefined, mediaKeys: ['three'] });
    expect(saved).toEqual([
        ['photos', 'album-photos'],
        ['trips', 'album-trips']
    ]);
});

test('an album failure reports the folder and leaves other folders untouched', async () => {
    const errors: [string, string][] = [];
    const saved: [string, string][] = [];

    await addFolderAlbums(
        [chunk('a', 'photos', 'one'), chunk('b', 'trips', 'two')],
        () => undefined,
        (folder, key) => saved.push([folder, key]),
        (folder) =>
            folder === 'photos'
                ? failed('Google rejected the album.')
                : assigned(`album-${folder}`),
        (folder, message) => errors.push([folder, message])
    );

    expect(errors).toEqual([['photos', 'Google rejected the album.']]);
    expect(saved).toEqual([['trips', 'album-trips']]);
});

test('a transient album failure is not retried', async () => {
    const calls: (string | undefined)[] = [];
    const saved: [string, string][] = [];

    await addFolderAlbums(
        [chunk('a', 'photos', 'one')],
        () => 'known-key',
        (folder, key) => saved.push([folder, key]),
        (_folder, key) => {
            calls.push(key);

            return failed('Google timed out.');
        },
        () => {}
    );

    expect(calls).toEqual(['known-key']);
    expect(saved).toEqual([]);
});
