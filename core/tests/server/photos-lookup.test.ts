import { createHash } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { hashLookup, hashLookupMany } from '../../src/server/photos/upload/lookup';
import { lookupHash } from '../../src/server/photos/upload/lookup-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import {
    bytesField,
    message,
    nested,
    parse,
    type Field
} from '@madkarmaa/phodrive-core/server/protobuf';

const EMAIL = 'lookup@example.com';

afterEach(clearThrottleState);

function sha1(value: string): Buffer {
    return createHash('sha1').update(value).digest();
}

function requestShape(body: Buffer): { hashes: Buffer[]; pageOptions: Field | undefined } {
    const request = parse(body).unwrap();
    expect(request.map((field) => field.number)).toEqual([1]);
    const cmqr = nested(body, 1).unwrap();
    const fields = parse(cmqr).unwrap();
    const hashes = fields.flatMap((field) => {
        if (field.number !== 1 || typeof field.value === 'number') return [];

        return [nested(field.value, 1).unwrap()];
    });

    return { hashes, pageOptions: fields.find((field) => field.number === 2) };
}

function resultEntry(sha1: Buffer, key?: string): Buffer {
    const fields = [bytesField(1, bytesField(1, sha1))];
    if (key !== undefined) fields.push(bytesField(2, bytesField(1, key)));

    return bytesField(2, message(...fields));
}

function batchResponse(entries: { sha1: Buffer; key?: string }[]): Response {
    return new Response(
        Uint8Array.from(
            bytesField(1, message(...entries.map((entry) => resultEntry(entry.sha1, entry.key))))
        )
    );
}

async function bodyOf(init: RequestInit | undefined): Promise<Buffer> {
    return Buffer.from(await new Response(init?.body).arrayBuffer());
}

test('batch lookup sends repeated SHA-1 entries and empty page options', async () => {
    const hashes = [sha1('first'), sha1('second')];
    let requestBody: Buffer | null = null;
    const fetcher: Fetcher = async (input, init) => {
        expect(String(input)).toContain('5084965799730810217');
        expect(init?.method).toBe('POST');
        requestBody = await bodyOf(init);

        return batchResponse([{ sha1: hashes[0], key: 'first-key' }]);
    };

    const result = await hashLookupMany(EMAIL, hashes, {}, fetcher);
    const mapped = result.unwrap();

    expect(mapped.get(hashes[0].toString('hex'))).toBe('first-key');
    expect(mapped.get(hashes[1].toString('hex'))).toBeNull();

    const shape = requestShape(requestBody!);
    expect(shape.hashes).toEqual(hashes);
    expect(shape.pageOptions?.value).toEqual(Buffer.alloc(0));
});

test('single lookup keeps the existing one-hash request contract', async () => {
    const hash = sha1('single');
    let requestBody: Buffer | null = null;
    const fetcher: Fetcher = async (_input, init) => {
        requestBody = await bodyOf(init);

        return batchResponse([{ sha1: hash, key: 'single-key' }]);
    };

    const result = await hashLookup(EMAIL, hash, {}, fetcher);

    expect(result.unwrap()).toBe('single-key');
    expect(requestShape(requestBody!).hashes).toEqual([hash]);
});

test('twenty concurrent lookups flush as one request', async () => {
    const hashes = Array.from({ length: 20 }, (_, index) => sha1(`batch-${index}`));
    const requests: Buffer[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const body = await bodyOf(init);
        requests.push(body);

        return batchResponse(
            requestShape(body).hashes.map((hash, index) => ({
                sha1: hash,
                key: `key-${index}`
            }))
        );
    };

    const results = await Promise.all(hashes.map((hash) => lookupHash(EMAIL, hash, {}, fetcher)));

    expect(requests).toHaveLength(1);
    expect(requestShape(requests[0]).hashes).toHaveLength(20);
    expect(results.map((result) => result.unwrap())).toEqual(
        hashes.map((_, index) => `key-${index}`)
    );
});

test('lookups batch by account across per-request transport wrappers', async () => {
    const hashes = [sha1('wrapper-a'), sha1('wrapper-b')];
    let requests = 0;
    const fetcher: Fetcher = async (_input, init) => {
        requests++;
        const shape = requestShape(await bodyOf(init));

        return batchResponse(shape.hashes.map((hash) => ({ sha1: hash, key: 'key' })));
    };
    const wrappers = hashes.map((): Fetcher => (input, init) => fetcher(input, init));

    const results = await Promise.all(
        hashes.map((hash, index) => lookupHash(EMAIL, hash, {}, wrappers[index]))
    );

    expect(requests).toBe(1);
    expect(results.map((result) => result.unwrap())).toEqual(['key', 'key']);
});

test('duplicate hashes in one batch resolve every caller', async () => {
    const duplicate = sha1('duplicate');
    const other = sha1('other');
    const requests: Buffer[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const body = await bodyOf(init);
        requests.push(body);

        return batchResponse(
            requestShape(body).hashes.map((hash) => ({
                sha1: hash,
                key: hash.equals(duplicate) ? 'duplicate-key' : 'other-key'
            }))
        );
    };

    const results = await Promise.all([
        lookupHash(EMAIL, duplicate, {}, fetcher),
        lookupHash(EMAIL, duplicate, {}, fetcher),
        lookupHash(EMAIL, other, {}, fetcher)
    ]);

    expect(requests).toHaveLength(1);
    expect(requestShape(requests[0]).hashes).toEqual([duplicate, other]);
    expect(results.map((result) => result.unwrap())).toEqual([
        'duplicate-key',
        'duplicate-key',
        'other-key'
    ]);
});

test('a failed batch falls back to one request per hash', async () => {
    const hashes = [sha1('fallback-a'), sha1('fallback-b'), sha1('fallback-c')];
    const requests: Buffer[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const body = await bodyOf(init);
        requests.push(body);
        const shape = requestShape(body);

        if (shape.hashes.length > 1) return new Response(null, { status: 400 });

        return batchResponse([
            { sha1: shape.hashes[0], key: `key-${shape.hashes[0].toString('hex')}` }
        ]);
    };

    const results = await Promise.all(hashes.map((hash) => lookupHash(EMAIL, hash, {}, fetcher)));

    expect(requests).toHaveLength(4);
    expect(results.map((result) => result.unwrap())).toEqual(
        hashes.map((hash) => `key-${hash.toString('hex')}`)
    );
});

test('a throttled batch propagates without extra fallback requests', async () => {
    const hashes = [sha1('throttled-a'), sha1('throttled-b')];
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    };

    const results = await Promise.all(
        hashes.map((hash) => lookupHash('throttled@example.com', hash, {}, fetcher))
    );

    expect(requests).toBe(1);
    expect(results.map((result) => result.unwrapErr())).toEqual([
        expect.objectContaining({ code: 'THROTTLED', retryAfterSeconds: 120 }),
        expect.objectContaining({ code: 'THROTTLED', retryAfterSeconds: 120 })
    ]);
});

test('missing results map to null for every requested hash', async () => {
    const present = sha1('present');
    const withoutKey = sha1('without-key');
    const omitted = sha1('omitted');
    const fetcher: Fetcher = async () =>
        batchResponse([{ sha1: present, key: 'present-key' }, { sha1: withoutKey }]);

    const result = await hashLookupMany(EMAIL, [present, withoutKey, omitted], {}, fetcher);
    const mapped = result.unwrap();

    expect(mapped.get(present.toString('hex'))).toBe('present-key');
    expect(mapped.get(withoutKey.toString('hex'))).toBeNull();
    expect(mapped.get(omitted.toString('hex'))).toBeNull();
});
