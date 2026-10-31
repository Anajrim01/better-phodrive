import { expect, test } from 'vitest';
import { MAX_ALBUM_BATCH_SIZE } from '@madkarmaa/phodrive-core/models';
import { assignFolderAlbum } from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { bytesField, message } from '@madkarmaa/phodrive-core/server/protobuf';

const AUTH_RESPONSE = `Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`;
const CREATE_ALBUM_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/8386163679468898444';
const ADD_MEDIA_TO_ALBUM_URL =
    'https://photosdata-pa.googleapis.com/6439526531001121323/484917746253879292';

function createdAlbum(albumKey: string): Buffer {
    return message(bytesField(1, message(bytesField(1, albumKey))));
}

function responseAfterAuth(response: () => Response): Fetcher {
    return async (input) =>
        String(input).includes('android.googleapis.com/auth')
            ? new Response(AUTH_RESPONSE)
            : response();
}

test('creating an album sends the folder name and every media key to Google', async () => {
    const requests: string[] = [];
    const bodies: Buffer[] = [];
    const fetcher: Fetcher = async (input, init) => {
        requests.push(String(input));

        if (requests.length === 1) return new Response(AUTH_RESPONSE);

        const received = await new Response(init?.body).arrayBuffer();
        bodies.push(Buffer.from(received));

        return new Response(Uint8Array.from(createdAlbum('created-album-key')));
    };

    const assigned = await assignFolderAlbum(
        'test@example.com',
        'aas_et/test',
        'Trips/2024',
        undefined,
        ['media-one', 'media-two'],
        fetcher
    );

    expect(assigned.unwrap()).toBe('created-album-key');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(CREATE_ALBUM_URL);
    expect(bodies[0].includes(Buffer.from('Trips/2024'))).toBe(true);
    expect(bodies[0].includes(Buffer.from('media-one'))).toBe(true);
    expect(bodies[0].includes(Buffer.from('media-two'))).toBe(true);
});

test('an existing album key adds media without creating another album', async () => {
    const requests: string[] = [];
    let body = Buffer.alloc(0);
    const fetcher: Fetcher = async (input, init) => {
        requests.push(String(input));

        if (requests.length === 1) return new Response(AUTH_RESPONSE);

        const received = await new Response(init?.body).arrayBuffer();
        body = Buffer.from(received);

        return new Response(Uint8Array.from([]));
    };

    const assigned = await assignFolderAlbum(
        'test@example.com',
        'aas_et/test',
        'Trips/2024',
        'existing-album-key',
        ['media-one'],
        fetcher
    );

    expect(assigned.unwrap()).toBe('existing-album-key');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(ADD_MEDIA_TO_ALBUM_URL);
    expect(requests).not.toContain(CREATE_ALBUM_URL);
    expect(body.includes(Buffer.from('existing-album-key'))).toBe(true);
    expect(body.includes(Buffer.from('media-one'))).toBe(true);
});

const INVALID_ASSIGNMENTS: [string, string, string[]][] = [
    ['an empty folder', '', ['media-key']],
    ['no media keys', 'Trips', []],
    [
        'too many media keys',
        'Trips',
        Array.from({ length: MAX_ALBUM_BATCH_SIZE + 1 }, (_, index) => `media-${index}`)
    ]
];

test.each(INVALID_ASSIGNMENTS)(
    'rejects %s without calling Google',
    async (_label, folder, mediaKeys) => {
        let calls = 0;
        const fetcher: Fetcher = async () => {
            calls++;

            return new Response(null);
        };

        const assigned = await assignFolderAlbum(
            'test@example.com',
            'aas_et/test',
            folder,
            undefined,
            mediaKeys,
            fetcher
        );

        expect(assigned.isErr()).toBe(true);
        expect(calls).toBe(0);
    }
);

test('HTTP failures and malformed create responses return Err', async () => {
    const failed = await assignFolderAlbum(
        'test@example.com',
        'aas_et/test',
        'Trips',
        undefined,
        ['media-key'],
        responseAfterAuth(() => new Response(null, { status: 503 }))
    );

    expect(failed.unwrapErr().message).toBe('Create album failed (HTTP 503)');

    const malformed = await assignFolderAlbum(
        'test@example.com',
        'aas_et/test',
        'Trips',
        undefined,
        ['media-key'],
        responseAfterAuth(() => new Response(Uint8Array.from([10, 5, 1])))
    );

    expect(malformed.unwrapErr().code).toBe('ALBUM_CREATE_RESPONSE_FAILED');
});
