import { expect, test } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { guardedSend, send } from '@madkarmaa/phodrive-core/server/photos/transport';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';

const URL = 'https://photos.example.test/upload';

function scope(coordinator = createThrottleCoordinator(() => 0)) {
    return { key: 'account-a', coordinator };
}

test('a throttled response keeps its status, stage, and Retry-After', async () => {
    const fetcher: Fetcher = async () =>
        new Response(null, { status: 429, headers: { 'retry-after': '1800' } });
    const result = await send(fetcher, URL, {}, 'Upload transfer');

    expect(result.unwrapErr()).toMatchObject({
        code: 'REQUEST_FAILED',
        stage: 'Upload transfer',
        status: 429,
        retryAfterSeconds: 1_800
    });
});

test('a throttled Google request becomes a typed THROTTLED error and records the cooldown', async () => {
    const fetcher: Fetcher = async () =>
        new Response(null, { status: 429, headers: { 'retry-after': '120' } });
    const throttle = scope();
    const result = await guardedSend(throttle, fetcher, URL, {}, 'Hash lookup');

    expect(result.unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120
    });
    expect(throttle.coordinator.remaining('account-a')).toBe(120);
});

test('server failures do not throttle until the legacy threshold is reached', async () => {
    const throttle = scope();
    const fail: Fetcher = async () => new Response(null, { status: 503 });

    expect((await guardedSend(throttle, fail, URL, {}, 'Hash lookup')).unwrapErr()).toMatchObject({
        code: 'REQUEST_FAILED',
        status: 503
    });
    expect(throttle.coordinator.remaining('account-a')).toBe(0);
    await guardedSend(throttle, fail, URL, {}, 'Hash lookup');
    expect(throttle.coordinator.remaining('account-a')).toBe(0);

    const tripped = await guardedSend(throttle, fail, URL, {}, 'Hash lookup');
    expect(tripped.unwrapErr()).toMatchObject({ code: 'THROTTLED' });
    expect(throttle.coordinator.remaining('account-a')).toBeGreaterThan(0);
});

test('an uncertain commit keeps its server failure instead of becoming retryable', async () => {
    const throttle = scope();
    const fail: Fetcher = async () => new Response(null, { status: 503 });

    for (let attempt = 1; attempt <= 3; attempt++)
        expect(
            (
                await guardedSend(throttle, fail, URL, {}, 'Commit', {
                    preserveServerFailure: true
                })
            ).unwrapErr()
        ).toMatchObject({ code: 'REQUEST_FAILED', status: 503, stage: 'Commit' });
});

test('a client error is returned unchanged and does not start a cooldown', async () => {
    const throttle = scope();
    const forbidden: Fetcher = async () => new Response(null, { status: 403 });
    const result = await guardedSend(throttle, forbidden, URL, {}, 'Authentication');

    expect(result.unwrapErr()).toMatchObject({
        code: 'REQUEST_FAILED',
        status: 403,
        stage: 'Authentication'
    });
    expect(throttle.coordinator.remaining('account-a')).toBe(0);
});

test('an abort after the wait resolves still prevents the Google request', async () => {
    const controller = new AbortController();
    const base = createThrottleCoordinator(() => 0);
    const coordinator = {
        ...base,
        wait: async () => {
            controller.abort();
        }
    };
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 500 });
    };

    const result = await guardedSend(
        { key: 'account-a', coordinator },
        fetcher,
        URL,
        { signal: controller.signal },
        'Authentication'
    );

    expect(result.unwrapErr()).toEqual({ code: 'UPLOAD_CANCELLED', message: 'Upload cancelled.' });
    expect(calls).toBe(0);
});
