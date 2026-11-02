import { expect, test } from 'vitest';
import {
    createEnvelopeRequest,
    decodeShareUrl,
    deleteEnvelopeRequest,
    linkStateRequest,
    buildShareUrl
} from '@madkarmaa/phodrive-core/server/share';
import { bytes, integer, parse } from '@madkarmaa/phodrive-core/server/protobuf';
import type { ShareManifest } from '@madkarmaa/phodrive-core/share-models';

const ALBUM_KEY = 'AF1QipAlbumKey';
const CANONICAL_ALBUM = 'https://photos.google.com/share/AbCdEf123?key=M2ZXZ1';
const FILE_ID = 'a'.repeat(64);

function fieldsOf(body: Buffer) {
    const fields = parse(body);
    if (fields.isErr()) throw new Error('expected protobuf fields');

    return fields.unwrap();
}

test('create envelope uses the corrected cpmo fields and five separate permission entries', () => {
    const request = createEnvelopeRequest(ALBUM_KEY, 'Holiday photos', 1_700_000_000_000);
    const fields = fieldsOf(request);

    expect(fields.map((field) => field.number)).toEqual([3, 4, 5, 8, 9, 9, 9, 9, 9, 9, 10]);
    expect(fields.filter((field) => field.number === 9).map((field) => field.value)).toEqual([
        4, 2, 3, 6, 7, 8
    ]);
    expect(integer(fields, 8).unwrap()).toBe(1_700_000_000_000);

    const permissions = fieldsOf(bytes(fields, 3).unwrap());
    expect(integer(permissions, 2).unwrap()).toBe(1);
    expect(integer(permissions, 5).unwrap()).toBe(1);
    const entries = permissions.filter((field) => field.number === 7);
    expect(entries).toHaveLength(5);
    expect(
        entries.map((entry) => {
            const permission = fieldsOf(entry.value as Buffer);
            const pair = fieldsOf(bytes(permission, 1).unwrap());

            return [
                integer(pair, 1).unwrap() + 1,
                integer(pair, 2).unwrap() + 1,
                integer(permission, 2).unwrap()
            ];
        })
    ).toEqual([
        [3, 2, 0],
        [3, 3, 0],
        [2, 2, 0],
        [2, 3, 0],
        [4, 2, 0]
    ]);

    const album = fieldsOf(bytes(fields, 4).unwrap());
    expect(integer(album, 1).unwrap()).toBe(1);
    expect(integer(album, 9).unwrap()).toBe(2);
    expect(bytes(album, 10).unwrap().toString('utf8')).toBe('Holiday photos');
    const albumTarget = bytes(fieldsOf(bytes(album, 2).unwrap()), 1).unwrap();
    expect(bytes(fieldsOf(albumTarget), 1).unwrap().toString()).toBe(ALBUM_KEY);

    const clientInfo = bytes(fields, 5).unwrap();
    expect(bytes(fields, 10).unwrap()).toEqual(clientInfo);
    const clientData = fieldsOf(bytes(fieldsOf(clientInfo), 1).unwrap());
    expect(clientData.map((field) => field.number)).toEqual([
        2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 15, 18, 20
    ]);
});

test('link state and delete envelope carry the envelope key', () => {
    const enabled = fieldsOf(linkStateRequest(ALBUM_KEY, 2));
    expect(integer(enabled, 2).unwrap()).toBe(2);
    expect(
        bytes(fieldsOf(bytes(enabled, 1).unwrap()), 1)
            .unwrap()
            .toString()
    ).toBe(ALBUM_KEY);

    const disabled = fieldsOf(linkStateRequest(ALBUM_KEY, 1));
    expect(integer(disabled, 2).unwrap()).toBe(1);

    const deleted = fieldsOf(deleteEnvelopeRequest(ALBUM_KEY));
    expect(bytes(deleted, 1).unwrap().toString()).toBe(ALBUM_KEY);
});

test('manifest v1 encodes into a base64url fragment without a query string', () => {
    const manifest: ShareManifest = {
        v: 1,
        album: CANONICAL_ALBUM,
        files: [{ id: FILE_ID, chunks: 3, name: 'photo.jpg' }]
    };
    const shareUrl = buildShareUrl(manifest).unwrap();

    expect(shareUrl.startsWith('https://shared.phodrive.dev/#share=')).toBe(true);
    expect(shareUrl).not.toContain('?share=');
    const encoded = shareUrl.slice('https://shared.phodrive.dev/#share='.length);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShareUrl(shareUrl).unwrap()).toEqual(manifest);
});

test('manifest encoding rejects non canonical album URLs and invalid counts', () => {
    const wrongHost: ShareManifest = {
        v: 1,
        album: 'https://example.com/share/abc?key=def',
        files: [{ id: FILE_ID, chunks: 1 }]
    };
    const noKey: ShareManifest = {
        v: 1,
        album: 'https://photos.google.com/share/abc',
        files: [{ id: FILE_ID, chunks: 1 }]
    };
    const zeroChunks: ShareManifest = {
        v: 1,
        album: CANONICAL_ALBUM,
        files: [{ id: FILE_ID, chunks: 0 }]
    };

    expect(buildShareUrl(wrongHost).isErr()).toBe(true);
    expect(buildShareUrl(noKey).isErr()).toBe(true);
    expect(buildShareUrl(zeroChunks).isErr()).toBe(true);
    expect(decodeShareUrl('https://shared.phodrive.dev/#share=not-valid').isErr()).toBe(true);
});
