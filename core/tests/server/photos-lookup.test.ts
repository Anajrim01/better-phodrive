import { expect, test } from 'vitest';
import { hashLookup, hashLookupMany } from '../../src/server/photos/upload/lookup';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { batchResponse, bodyOf, requestShape, sha1 } from '../helpers/lookup';

const EMAIL = 'lookup@example.com';

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

test('an unrequested echoed hash fails the batch', async () => {
    const requested = sha1('requested');
    const wrong = sha1('wrong');
    const fetcher: Fetcher = async () => batchResponse([{ sha1: wrong, key: 'wrong-key' }]);

    const result = await hashLookupMany(EMAIL, [requested], {}, fetcher);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.HASH_LOOKUP_MISMATCH);
});

test('duplicate echoed results fail the batch', async () => {
    const hash = sha1('duplicated-result');
    const fetcher: Fetcher = async () =>
        batchResponse([
            { sha1: hash, key: 'first-key' },
            { sha1: hash, key: 'second-key' }
        ]);

    const result = await hashLookupMany(EMAIL, [hash], {}, fetcher);

    expect(result.unwrapErr()).toEqual(SERVER_ERRORS.HASH_LOOKUP_MISMATCH);
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
