import { expect, test } from 'vitest';
import { bytes, integer, parse, type Field } from '@madkarmaa/phodrive-core/server/protobuf';
import {
    createAlbumRequest,
    createEnvelopeRequest,
    deleteEnvelopeRequest,
    LINK_STATE_DISABLED,
    LINK_STATE_ENABLED,
    linkStateRequest,
    parseCreatedAlbum,
    parseEnvelopeResponse,
    parseLinkStateResponse,
    removeAlbumRequest
} from '@madkarmaa/phodrive-core/server/photos/shares/google-requests';
import {
    classifyMutationFailure,
    createShareAlbum
} from '@madkarmaa/phodrive-core/server/photos/shares/google-rpc';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { ServerError } from '@madkarmaa/phodrive-core/server/errors';
import { bytes as encode, num } from '../helpers/protobuf';

const SHORT_URL = 'https://photos.app.goo.gl/Abc_123-x';

function fieldsOf(body: Buffer): Field[] {
    return parse(body).unwrap();
}

function requestFailure(status?: number): ServerError {
    return { code: 'REQUEST_FAILED', message: 'failed', ...(status ? { status } : {}) };
}

test('create album names every media key once with the requested title', () => {
    const fields = fieldsOf(createAlbumRequest('Fixtures', ['key-1', 'key-2'], 1_700_000_000_000));

    expect(bytes(fields, 1).unwrap().toString()).toBe('Fixtures');
    expect(integer(fields, 2).unwrap()).toBe(1_700_000_000_000);

    const keys = fields
        .filter((field) => field.number === 4)
        .map((field) =>
            bytes(fieldsOf(bytes(fieldsOf(field.value as Buffer), 1).unwrap()), 1)
                .unwrap()
                .toString()
        );

    expect(keys).toEqual(['key-1', 'key-2']);
});

test('create envelope keeps the five permission entries and targets the album', () => {
    const fields = fieldsOf(createEnvelopeRequest('album-key', 'Fixtures', 1_700_000_000_000));

    expect(fields.map((field) => field.number)).toEqual([3, 4, 5, 8, 9, 9, 9, 9, 9, 9, 10]);
    expect(fieldsOf(bytes(fields, 3).unwrap()).filter((field) => field.number === 7)).toHaveLength(
        5
    );

    const album = fieldsOf(bytes(fields, 4).unwrap());
    const target = bytes(fieldsOf(bytes(album, 2).unwrap()), 1).unwrap();

    expect(bytes(fieldsOf(target), 1).unwrap().toString()).toBe('album-key');
    expect(bytes(album, 10).unwrap().toString()).toBe('Fixtures');
});

test.each([
    ['enable', LINK_STATE_ENABLED],
    ['disable', LINK_STATE_DISABLED]
])('%s link carries the envelope key and state', (_name, state) => {
    const fields = fieldsOf(linkStateRequest('envelope-key', state));

    expect(integer(fields, 2).unwrap()).toBe(state);
    expect(
        bytes(fieldsOf(bytes(fields, 1).unwrap()), 1)
            .unwrap()
            .toString()
    ).toBe('envelope-key');
});

test('deletes address only the exact key', () => {
    expect(
        bytes(fieldsOf(removeAlbumRequest('album-key')), 1)
            .unwrap()
            .toString()
    ).toBe('album-key');
    expect(
        bytes(fieldsOf(deleteEnvelopeRequest('envelope-key')), 1)
            .unwrap()
            .toString()
    ).toBe('envelope-key');
});

test('response parsers return exact keys and reject values unsafe to re-send', () => {
    expect(parseCreatedAlbum(encode(1, encode(1, 'album-key'))).unwrap()).toBe('album-key');
    expect(parseCreatedAlbum(encode(1, encode(1, 'album key'))).isErr()).toBe(true);
    expect(parseCreatedAlbum(Buffer.alloc(0)).isErr()).toBe(true);

    const envelope = Buffer.concat([encode(1, 'envelope-key'), encode(2, SHORT_URL)]);

    expect(parseEnvelopeResponse(envelope).unwrap()).toEqual({
        envelopeKey: 'envelope-key',
        pendingShortUrl: SHORT_URL
    });
    expect(parseEnvelopeResponse(encode(1, 'envelope-key')).unwrap()).toEqual({
        envelopeKey: 'envelope-key'
    });
    expect(parseEnvelopeResponse(Buffer.concat([encode(1, 'k'), num(2, 1)])).isErr()).toBe(true);
    expect(
        parseEnvelopeResponse(
            Buffer.concat([encode(1, 'k'), encode(2, 'https://evil.example/x')])
        ).isErr()
    ).toBe(true);

    const link = Buffer.concat([encode(1, encode(1, SHORT_URL)), encode(2, 'auth-key')]);

    expect(parseLinkStateResponse(link).unwrap()).toEqual({
        shortUrl: SHORT_URL,
        authKey: 'auth-key'
    });
    expect(parseLinkStateResponse(encode(1, encode(1, SHORT_URL))).isErr()).toBe(true);
});

test('only a definite refusal or missing target is treated as a known outcome', () => {
    expect(classifyMutationFailure(requestFailure(404))).toBe('gone');
    expect(classifyMutationFailure(requestFailure(410))).toBe('gone');
    expect(classifyMutationFailure(requestFailure(400))).toBe('rejected');
    expect(classifyMutationFailure(requestFailure(403))).toBe('rejected');
    expect(classifyMutationFailure(requestFailure(408))).toBe('uncertain');
    expect(classifyMutationFailure(requestFailure(429))).toBe('uncertain');
    expect(classifyMutationFailure(requestFailure(503))).toBe('uncertain');
    expect(classifyMutationFailure(requestFailure())).toBe('uncertain');
    expect(
        classifyMutationFailure({ code: 'THROTTLED', message: 'wait', retryAfterSeconds: 60 })
    ).toBe('uncertain');
    expect(
        classifyMutationFailure({
            code: 'GOOGLE_SHARE_RESPONSE_INVALID',
            message: 'Google Photos returned an unexpected share response.'
        })
    ).toBe('uncertain');
});

test('owner RPCs send once and report a 429 through the account throttle scope', async () => {
    const coordinator = createThrottleCoordinator();
    let calls = 0;
    const result = await createShareAlbum(
        {
            rpcHeaders: { authorization: 'Bearer test' },
            scope: { key: 'account', coordinator },
            fetcher: async () => {
                calls += 1;

                return new Response(null, { status: 429, headers: { 'retry-after': '30' } });
            }
        },
        'Fixtures',
        ['key-1']
    );

    expect(calls).toBe(1);
    expect(result.unwrapErr().code).toBe('THROTTLED');
    expect(coordinator.remaining('account')).toBeGreaterThan(0);
});
