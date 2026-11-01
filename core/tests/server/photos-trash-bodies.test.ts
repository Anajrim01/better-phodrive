import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { deletePermanently, restoreFromTrash } from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { parse } from '@madkarmaa/phodrive-core/server/protobuf';
import { authResponse } from '../helpers/photos';

const SHA1 = createHash('sha1').update('transfer body').digest('hex');
const SHA1_B = createHash('sha1').update('second body').digest('hex');

function bodyFetcher(request: { body?: Buffer }): Fetcher {
    return async (input, init) => {
        if (String(input).includes('android.googleapis.com/auth')) return authResponse();

        request.body = Buffer.from(await new Response(init?.body).arrayBuffer());

        return new Response(new Uint8Array());
    };
}

test('restore sends one key per sha1 with the restore operation', async () => {
    const request: { body?: Buffer } = {};
    const result = await restoreFromTrash(
        'test@example.com',
        'aas_et/test',
        [SHA1, SHA1_B],
        bodyFetcher(request)
    );
    const fields = parse(request.body!).unwrap();

    expect(result.isOk()).toBe(true);
    expect(fields.find((field) => field.number === 2)?.value).toBe(3);
    expect(fields.find((field) => field.number === 4)?.value).toBe(2);
    expect(fields.filter((field) => field.number === 3)).toHaveLength(2);
    expect(fields.some((field) => field.number === 8)).toBe(true);
    expect(fields.some((field) => field.number === 9)).toBe(true);
});

test('permanent delete sends the delete operation with an empty client context', async () => {
    const request: { body?: Buffer } = {};
    const result = await deletePermanently(
        'test@example.com',
        'aas_et/test',
        [SHA1],
        bodyFetcher(request)
    );
    const fields = parse(request.body!).unwrap();

    expect(result.isOk()).toBe(true);
    expect(fields.find((field) => field.number === 2)?.value).toBe(2);
    expect(fields.find((field) => field.number === 4)?.value).toBe(2);
    expect(fields.filter((field) => field.number === 3)).toHaveLength(1);
    expect(fields.some((field) => field.number === 8)).toBe(true);
    expect(fields.find((field) => field.number === 9)?.value).toEqual(Buffer.alloc(0));
});
