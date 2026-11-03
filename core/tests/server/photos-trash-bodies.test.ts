import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import {
    deletePermanently,
    moveToTrashBatch,
    restoreFromTrash
} from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { parse } from '@madkarmaa/phodrive-core/server/protobuf';
import { authResponse, deleteResponse } from '../helpers/photos';
import { CAPTURED_ALREADY_TRASHED, CAPTURED_ALREADY_TRASHED_KEY } from '../helpers/delete-response';

const SHA1 = createHash('sha1').update('transfer body').digest('hex');
const SHA1_B = createHash('sha1').update('second body').digest('hex');

function bodyFetcher(
    request: { body?: Buffer },
    mediaKeys: readonly string[] = ['media-a', 'media-b']
): Fetcher {
    return async (input, init) => {
        if (String(input).includes('android.googleapis.com/auth')) return authResponse();

        request.body = Buffer.from(await new Response(init?.body).arrayBuffer());

        return deleteResponse(mediaKeys);
    };
}

test('restore sends one key per sha1 with the restore operation', async () => {
    const request: { body?: Buffer } = {};
    const result = await restoreFromTrash(
        'test@example.com',
        'aas_et/test',
        [SHA1, SHA1_B],
        bodyFetcher(request),
        ['media-a', 'media-b']
    );
    const fields = parse(request.body!).unwrap();

    expect(result.isOk()).toBe(true);
    expect(fields.find((field) => field.number === 2)?.value).toBe(3);
    expect(fields.find((field) => field.number === 4)?.value).toBe(2);
    expect(fields.filter((field) => field.number === 3)).toHaveLength(2);
    expect(fields.some((field) => field.number === 8)).toBe(true);
    expect(fields.some((field) => field.number === 9)).toBe(true);
});

test('trash sends one key per sha1 with the trash operation', async () => {
    const request: { body?: Buffer } = {};
    const result = await moveToTrashBatch(
        'test@example.com',
        'aas_et/test',
        [SHA1, SHA1_B],
        bodyFetcher(request),
        ['media-a', 'media-b']
    );
    const fields = parse(request.body!).unwrap();

    expect(result.isOk()).toBe(true);
    expect(fields.find((field) => field.number === 2)?.value).toBe(1);
    expect(fields.find((field) => field.number === 4)?.value).toBe(1);
    expect(fields.filter((field) => field.number === 3)).toHaveLength(2);
    expect(fields.some((field) => field.number === 8)).toBe(true);
    expect(fields.some((field) => field.number === 9)).toBe(true);
});

test('trash accepts an already-trashed response without a requested key', async () => {
    const fetcher: Fetcher = async (input) => {
        if (String(input).includes('android.googleapis.com/auth')) return authResponse();

        return new Response(CAPTURED_ALREADY_TRASHED);
    };

    const result = await moveToTrashBatch('test@example.com', 'aas_et/test', [SHA1], fetcher, [
        CAPTURED_ALREADY_TRASHED_KEY
    ]);

    expect(result.isOk()).toBe(true);
});

test('an empty trash batch sends no request', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response();
    };

    const result = await moveToTrashBatch('test@example.com', 'aas_et/test', [], fetcher, []);

    expect(result.isOk()).toBe(true);
    expect(calls).toBe(0);
});

test('permanent delete sends the delete operation with an empty client context', async () => {
    const request: { body?: Buffer } = {};
    const result = await deletePermanently(
        'test@example.com',
        'aas_et/test',
        [SHA1],
        bodyFetcher(request, ['media-a']),
        ['media-a']
    );
    const fields = parse(request.body!).unwrap();

    expect(result.isOk()).toBe(true);
    expect(fields.find((field) => field.number === 2)?.value).toBe(2);
    expect(fields.find((field) => field.number === 4)?.value).toBe(2);
    expect(fields.filter((field) => field.number === 3)).toHaveLength(1);
    expect(fields.some((field) => field.number === 8)).toBe(true);
    expect(fields.find((field) => field.number === 9)?.value).toEqual(Buffer.alloc(0));
});

test('a malformed successful permanent delete response is rejected', async () => {
    const request: { body?: Buffer } = {};
    const fetcher: Fetcher = async (input, init) => {
        if (String(input).includes('android.googleapis.com/auth')) return authResponse();

        request.body = Buffer.from(await new Response(init?.body).arrayBuffer());

        return new Response('not a protobuf delete result');
    };

    const result = await deletePermanently('test@example.com', 'aas_et/test', [SHA1], fetcher, [
        'media-a'
    ]);

    expect(request.body).toBeDefined();
    expect(result.unwrapErr().code).toBe('INVALID_DELETE_RESPONSE');
});

test('a delete response for another media key is rejected', async () => {
    const request: { body?: Buffer } = {};
    const result = await deletePermanently(
        'test@example.com',
        'aas_et/test',
        [SHA1],
        bodyFetcher(request, ['other-media']),
        ['media-a']
    );

    expect(result.unwrapErr().code).toBe('INVALID_DELETE_RESPONSE');
});
