import { bytesField, integer, message, parse } from '@madkarmaa/phodrive-core/server/protobuf';
import type {
    ShareCreateRequest,
    ShareExisting,
    ShareRevokeRequest
} from '@madkarmaa/phodrive-core/share-models';
import { buildShareUrl } from '@madkarmaa/phodrive-core/server/share';

export const AUTH_RESPONSE = `Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`;
export const ALBUM_KEY = 'AF1QipAlbum';
export const ENVELOPE_KEY = 'AF1QipEnvelope';
export const SHORT_URL = 'https://photos.app.goo.gl/abc123';
export const CANONICAL = 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1';
export const AUTH_KEY = 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR';
export const FILE_ID = 'a'.repeat(64);
export const SECOND_FILE_ID = 'b'.repeat(64);
export const CREATE_ALBUM =
    'https://photosdata-pa.googleapis.com/6439526531001121323/8386163679468898444';
export const CREATE_ENVELOPE =
    'https://photosdata-pa.googleapis.com/6439526531001121323/11663664809460121647';
export const UPDATE_LINK =
    'https://photosdata-pa.googleapis.com/$rpc/social.frontend.photos.sharingdata.v1.PhotosSharingDataService/PhotosUpdateLinkSharingState';
export const DELETE_ENVELOPE =
    'https://photosdata-pa.googleapis.com/6439526531001121323/8089014401670041416';
export const REMOVE_ALBUM =
    'https://photosdata-pa.googleapis.com/6439526531001121323/11165707358190966680';

export function bodyResponse(body: Buffer): Response {
    return new Response(new Uint8Array(body));
}

export function protobuf(body: BodyInit | null | undefined): Buffer {
    return Buffer.from(body instanceof Uint8Array ? body : String(body ?? ''));
}

export function albumResponse(key: string): Buffer {
    return message(bytesField(1, message(bytesField(1, key))));
}

export function envelopeResponse(key: string, pending: string): Buffer {
    return message(bytesField(1, key), bytesField(2, pending));
}

export function linkResponse(url: string): Buffer {
    return message(bytesField(1, message(bytesField(1, url))), bytesField(2, AUTH_KEY));
}

export function requestState(body: Buffer): number {
    return integer(parse(body).unwrap(), 2).unwrap();
}

export function htmlPage(): Response {
    return new Response(
        `<html><script>["${SHORT_URL}", "https://lh3.googleusercontent.com/p/abc"]</script></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
    );
}

const FILES = [
    {
        id: FILE_ID,
        name: 'photo.jpg',
        chunks: [
            { index: 0, mediaKey: 'media-0' },
            { index: 1, mediaKey: 'media-1' }
        ]
    },
    {
        id: SECOND_FILE_ID,
        name: 'notes.txt',
        chunks: [{ index: 0, mediaKey: 'media-2' }]
    }
] as const;

export const EXISTING_SHARE: ShareExisting = {
    envelopeKey: ENVELOPE_KEY,
    albumKey: ALBUM_KEY,
    shortUrl: SHORT_URL,
    albumUrl: CANONICAL,
    authKey: 'auth-key',
    shareUrl: buildShareUrl({
        v: 1,
        album: CANONICAL,
        files: [
            { id: FILE_ID, chunks: 2, name: 'photo.jpg' },
            { id: SECOND_FILE_ID, chunks: 1, name: 'notes.txt' }
        ]
    }).unwrap()
};

export function request(overrides: Partial<ShareCreateRequest> = {}): ShareCreateRequest {
    return {
        action: 'create',
        email: `${crypto.randomUUID()}@example.com`,
        token: 'aas_et/test',
        name: 'Share name',
        files: FILES.map((file) => ({
            ...file,
            chunks: file.chunks.map((chunk) => ({ ...chunk }))
        })),
        ...overrides
    };
}

export function revokeRequest(overrides: Partial<ShareRevokeRequest> = {}): ShareRevokeRequest {
    return {
        action: 'revoke',
        email: `${crypto.randomUUID()}@example.com`,
        token: 'aas_et/test',
        envelopeKey: ENVELOPE_KEY,
        albumKey: ALBUM_KEY,
        shortUrl: SHORT_URL,
        albumUrl: CANONICAL,
        ...overrides
    };
}
