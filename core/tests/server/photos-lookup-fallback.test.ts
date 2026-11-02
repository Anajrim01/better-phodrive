import { afterEach, expect, test } from 'vitest';
import { lookupHash } from '../../src/server/photos/upload/lookup-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { batchResponse, bodyOf, requestShape, sha1 } from '../helpers/lookup';

const EMAIL = 'lookup@example.com';

afterEach(clearThrottleState);

test('a held fallback does not block a completed fallback', async () => {
    const heldHash = sha1('held-fallback');
    const fastHash = sha1('fast-fallback');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let fallbackStarted!: () => void;
    const fallback = new Promise<void>((resolve) => {
        fallbackStarted = resolve;
    });
    const fetcher: Fetcher = async (_input, init) => {
        const shape = requestShape(await bodyOf(init));
        if (shape.hashes.length > 1) return new Response(null, { status: 400 });

        if (shape.hashes[0].equals(heldHash)) {
            fallbackStarted();
            await held;
        }

        return batchResponse([
            { sha1: shape.hashes[0], key: `key-${shape.hashes[0].toString('hex')}` }
        ]);
    };

    const heldLookup = lookupHash(EMAIL, heldHash, {}, fetcher);
    const fastLookup = lookupHash(EMAIL, fastHash, {}, fetcher);
    await fallback;
    const fastResult = await Promise.race([
        fastLookup.then((result) => result.unwrap()),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 100))
    ]);
    release();
    await heldLookup;

    expect(fastResult).toBe(`key-${fastHash.toString('hex')}`);
});

test('an aborted fallback waiter does not block a duplicate', async () => {
    const hash = sha1('aborted-fallback-duplicate');
    const abort = new AbortController();
    let requests = 0;
    let singleRequests = 0;
    let heldStarted!: () => void;
    const heldStart = new Promise<void>((resolve) => {
        heldStarted = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const fetcher: Fetcher = async (_input, init) => {
        const shape = requestShape(await bodyOf(init));
        requests++;
        if (requests === 1) return new Response(null, { status: 400 });

        singleRequests++;
        if (singleRequests === 1) {
            heldStarted();
            await held;
        }

        return batchResponse([{ sha1: shape.hashes[0], key: 'key' }]);
    };

    const first = lookupHash(EMAIL, hash, {}, fetcher, abort.signal);
    const second = lookupHash(EMAIL, hash, {}, fetcher);
    await heldStart;
    abort.abort();
    const secondResult = await Promise.race([
        second.then((result) => result.unwrap()),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 100))
    ]);
    release();
    const firstResult = await first;

    expect(secondResult).toBe('key');
    expect(firstResult.unwrapErr()).toMatchObject({ code: 'REQUEST_FAILED' });
});

test('a server failure propagates without fallback requests', async () => {
    const hashes = [sha1('server-a'), sha1('server-b')];
    let requests = 0;
    const fetcher: Fetcher = async () => {
        requests++;

        return new Response(null, { status: 500 });
    };

    const results = await Promise.all(
        hashes.map((hash) => lookupHash('server-failure@example.com', hash, {}, fetcher))
    );

    expect(requests).toBe(1);
    expect(results.map((result) => result.unwrapErr())).toEqual([
        expect.objectContaining({ code: 'REQUEST_FAILED', status: 500 }),
        expect.objectContaining({ code: 'REQUEST_FAILED', status: 500 })
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
