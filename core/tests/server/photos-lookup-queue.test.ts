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

test('an aborted duplicate does not cancel the active caller', async () => {
    const hash = sha1('aborted-duplicate');
    const abort = new AbortController();
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return batchResponse([{ sha1: hash, key: 'active-key' }]);
    };

    const aborted = lookupHash(EMAIL, hash, {}, fetcher, abort.signal);
    const active = lookupHash(EMAIL, hash, {}, fetcher);
    abort.abort();
    const results = await Promise.all([aborted, active]);

    expect(results[0].unwrapErr()).toMatchObject({ code: 'REQUEST_FAILED' });
    expect(results[1].unwrap()).toBe('active-key');
    expect(requests).toBe(1);
});

test('an aborted caller settles while the shared batch is held', async () => {
    const firstHash = sha1('held-first');
    const secondHash = sha1('held-second');
    const abort = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const fetcher: Fetcher = async (_input, init) => {
        const shape = requestShape(await bodyOf(init));
        started();
        await held;

        return batchResponse(shape.hashes.map((hash) => ({ sha1: hash, key: 'key' })));
    };

    const first = lookupHash(EMAIL, firstHash, {}, fetcher);
    const second = lookupHash(EMAIL, secondHash, {}, fetcher, abort.signal);
    await start;
    abort.abort();
    const code = await Promise.race([
        second.then((result) => result.unwrapErr().code),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 100))
    ]);
    release();
    const firstResult = await first;

    expect(code).toBe('REQUEST_FAILED');
    expect(firstResult.unwrap()).toBe('key');
});

test('an aborted first caller does not cancel the shared batch', async () => {
    const firstHash = sha1('first-aborted');
    const secondHash = sha1('second-active');
    const abort = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const fetcher: Fetcher = async (_input, init) => {
        const shape = requestShape(await bodyOf(init));
        started();
        await held;

        return batchResponse(shape.hashes.map((hash) => ({ sha1: hash, key: 'key' })));
    };

    const first = lookupHash(EMAIL, firstHash, {}, fetcher, abort.signal);
    const second = lookupHash(EMAIL, secondHash, {}, fetcher);
    await start;
    abort.abort();
    const firstCode = await Promise.race([
        first.then((result) => result.unwrapErr().code),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 100))
    ]);
    release();
    const secondResult = await second;

    expect(firstCode).toBe('REQUEST_FAILED');
    expect(secondResult.unwrap()).toBe('key');
});
