import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { guardedSend } from '@madkarmaa/phodrive-core/server/photos/transport';
import {
    createThrottleCoordinator,
    parseRetryAfter,
    THROTTLE_MAX_SECONDS,
    waitForThrottle
} from '@madkarmaa/phodrive-core/server/photos/throttle';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

test('an 1800-second cooldown is kept in full and capped above it', () => {
    const throttle = createThrottleCoordinator(() => 0);

    expect(throttle.pause('account-a', 1_800)).toBe(1_800);
    expect(throttle.remaining('account-a')).toBe(1_800);
    expect(throttle.pause('account-a', 9_000)).toBe(1_800);
    expect(throttle.remaining('account-a')).toBe(1_800);
});

test('Retry-After accepts seconds, decimals, and HTTP dates', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);

    expect(parseRetryAfter('120', now)).toBe(120);
    expect(parseRetryAfter('120.2', now)).toBe(121);
    expect(parseRetryAfter(new Date(now + 120_000).toUTCString(), now)).toBe(120);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('', now)).toBeUndefined();
    expect(parseRetryAfter('later', now)).toBeUndefined();
});

test('a known cooldown wakes at the extended deadline after a re-check', async () => {
    const throttle = createThrottleCoordinator(() => 0);
    throttle.pause('account-a', 60);

    let resumed = false;
    const waiting = throttle.wait('account-a').then(() => {
        resumed = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    throttle.pause('account-a', 120);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(resumed).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await waiting;
    expect(resumed).toBe(true);
});

test('waiters for the same account resume with independent jitter', async () => {
    const values = [0, 0.5];
    const throttle = createThrottleCoordinator(() => values.shift() ?? 0);
    throttle.pause('account-a', 60);

    let first = false;
    let second = false;
    const one = throttle.wait('account-a').then(() => {
        first = true;
    });
    const two = throttle.wait('account-a').then(() => {
        second = true;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(first).toBe(true);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500);
    await Promise.all([one, two]);
    expect(second).toBe(true);
});

test('another account does not inherit a cooldown', async () => {
    const throttle = createThrottleCoordinator(() => 0);
    throttle.pause('account-a', 1_800);

    await expect(throttle.wait('account-b')).resolves.toBeUndefined();
    expect(throttle.remaining('account-b')).toBe(0);
});

test('cancelling a cooldown or jitter wait stops the waiter', async () => {
    const throttle = createThrottleCoordinator(() => 0.5);
    throttle.pause('account-a', 60);
    const controller = new AbortController();
    const waiting = throttle.wait('account-a', controller.signal);

    await vi.advanceTimersByTimeAsync(62_000);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
});

test('cancelling one account wait leaves another account cooldown intact', async () => {
    const throttle = createThrottleCoordinator(() => 0);
    throttle.pause('account-a', 60);
    throttle.pause('account-b', 60);
    const controller = new AbortController();
    const waiting = throttle.wait('account-a', controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

    expect(throttle.remaining('account-b')).toBe(60);
    const other = throttle.wait('account-b');
    await vi.advanceTimersByTimeAsync(60_000);
    await other;
});

test('waitForThrottle returns a typed cancellation instead of a boolean', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    coordinator.pause('account-a', 60);
    const controller = new AbortController();
    const waiting = waitForThrottle({ key: 'account-a', coordinator }, controller.signal);
    controller.abort();

    expect((await waiting).unwrapErr()).toEqual({
        code: 'UPLOAD_CANCELLED',
        message: 'Upload cancelled.'
    });
});

test('three consecutive server failures start bounded exponential backoff', async () => {
    const throttle = createThrottleCoordinator(() => 0.5);

    expect(throttle.serverFailure('account-a')).toBeNull();
    expect(throttle.serverFailure('account-a')).toBeNull();
    expect(throttle.serverFailure('account-a')).toBe(60);
    expect(throttle.remaining('account-a')).toBe(60);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(throttle.serverFailure('account-a')).toBe(120);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(throttle.serverFailure('account-a')).toBe(240);
    expect(THROTTLE_MAX_SECONDS).toBe(1_800);
});

test('a successful request clears failures, but not a pause recorded after it started', () => {
    const throttle = createThrottleCoordinator(() => 0);
    throttle.serverFailure('account-a');
    throttle.serverFailure('account-a');
    throttle.serverSuccess('account-a');
    expect(throttle.serverFailure('account-a')).toBeNull();
    expect(throttle.serverFailure('account-a')).toBeNull();

    const startedAt = Date.now() - 1;
    throttle.pause('account-a', 60);
    throttle.success('account-a', startedAt);
    expect(throttle.remaining('account-a')).toBe(60);

    throttle.success('account-a', Date.now() + 1);
    expect(throttle.remaining('account-a')).toBe(0);
});

test('a success that started in the same millisecond as a pause cannot clear it', () => {
    const throttle = createThrottleCoordinator(() => 0);
    const startedAt = Date.now();
    throttle.pause('account-a', 60);

    throttle.success('account-a', startedAt);
    expect(throttle.remaining('account-a')).toBe(60);

    throttle.success('account-a', Date.now() + 1);
    expect(throttle.remaining('account-a')).toBe(0);
});

test('a concurrent success cannot clear a pause recorded by a same-account 429', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    let calls = 0;
    let releaseThrottled!: () => void;
    let releaseSuccess!: () => void;
    const throttled = new Promise<Response>((resolve) => {
        releaseThrottled = () =>
            resolve(new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
    });
    const success = new Promise<Response>((resolve) => {
        releaseSuccess = () => resolve(new Response(null, { status: 200 }));
    });
    const fetcher: Fetcher = async () => {
        calls++;

        return calls === 1 ? throttled : success;
    };
    const scope = { key: 'account-a', coordinator };

    const first = guardedSend(scope, fetcher, 'https://photos.test/library', {}, 'Library list');
    const second = guardedSend(scope, fetcher, 'https://photos.test/library', {}, 'Library list');
    await vi.waitFor(() => expect(calls).toBe(2));

    releaseThrottled();
    expect((await first).unwrapErr()).toMatchObject({
        code: 'THROTTLED',
        retryAfterSeconds: 120
    });
    expect(coordinator.remaining('account-a')).toBe(120);

    releaseSuccess();
    expect((await second).isOk()).toBe(true);
    expect(coordinator.remaining('account-a')).toBe(120);
});

test('a missing Retry-After falls back to the bounded backoff', () => {
    const throttle = createThrottleCoordinator(() => 0.5);

    expect(throttle.pause('account-a')).toBe(60);
});
