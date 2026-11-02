import { expect, test } from 'vitest';
import { lookupHash } from '../../src/server/photos/upload/lookup-queue';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { batchResponse, bodyOf, requestShape, sha1 } from '../helpers/lookup';

const EMAIL = 'lookup@example.com';

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

test('an aborted first caller does not trigger fallback on a server failure', async () => {
    const firstHash = sha1('aborted-server-first');
    const secondHash = sha1('aborted-server-second');
    const abort = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let requests = 0;
    const fetcher: Fetcher = async (_input, init) => {
        requests++;
        await bodyOf(init);
        started();
        await held;

        return new Response(null, { status: 500 });
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
    expect(secondResult.unwrapErr()).toMatchObject({ code: 'REQUEST_FAILED', status: 500 });
    expect(requests).toBe(1);
});

test('aborting every caller aborts the shared batch request', async () => {
    const firstHash = sha1('abandoned-first');
    const secondHash = sha1('abandoned-second');
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    let signal: AbortSignal | undefined;
    const fetcher: Fetcher = async (_input, init) => {
        signal = init?.signal ?? undefined;
        started();
        await new Promise<void>((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });

        return batchResponse([]);
    };

    const first = lookupHash(EMAIL, firstHash, {}, fetcher, firstAbort.signal);
    const second = lookupHash(EMAIL, secondHash, {}, fetcher, secondAbort.signal);
    const firstDone = first.then((result) => result);
    const secondDone = second.then((result) => result);
    await start;
    firstAbort.abort();
    expect(signal?.aborted).toBe(false);
    secondAbort.abort();
    await Promise.all([firstDone, secondDone]);

    expect(signal?.aborted).toBe(true);
});
