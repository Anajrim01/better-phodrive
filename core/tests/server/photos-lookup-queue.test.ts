import { expect, test } from 'vitest';
import { lookupHash } from '../../src/server/photos/upload/lookup-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { batchResponse, bodyOf, requestShape, sha1 } from '../helpers/lookup';

const EMAIL = 'lookup@example.com';

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

test('a pending lookup batch keeps a referenced timer', async () => {
    const hash = sha1('referenced-timer');
    const before = process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length;
    const lookup = lookupHash(EMAIL, hash, {}, async () =>
        batchResponse([{ sha1: hash, key: 'key' }])
    );
    await Promise.resolve();
    const during = process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length;
    const result = await lookup;

    expect(during).toBeGreaterThan(before);
    expect(result.unwrap()).toBe('key');
});
