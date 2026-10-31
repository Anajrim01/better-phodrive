import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    THROTTLE_FAILURE_LIMIT,
    THROTTLE_MAX_SECONDS,
    clearThrottleState,
    parseRetryAfter,
    recordServerFailure,
    recordServerSuccess,
    recordSuccess,
    recordThrottle,
    throttleWaitSeconds
} from '../../src/server/photos/throttle';
import { guardedSend, send } from '../../src/server/photos/transport';
import { isThrottleError, throttleError } from '../../src/server/errors';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

const EMAIL = 'test@example.com';
const OTHER_EMAIL = 'other@example.com';
const START = Date.UTC(2026, 0, 1, 12, 0, 0);
const NO_JITTER = () => 0.5;

let now = START;

beforeEach(() => {
    clearThrottleState();
    now = START;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
    vi.restoreAllMocks();
    clearThrottleState();
});

function nextThrottle(): number {
    const wait = recordThrottle(EMAIL, undefined, NO_JITTER);
    now += wait * 1_000;

    return wait;
}

test('Retry-After parses delta seconds, HTTP dates, and rejects junk', () => {
    expect(parseRetryAfter('120', START)).toBe(120);
    expect(parseRetryAfter('1.5', START)).toBe(2);
    expect(parseRetryAfter(new Date(START + 90_000).toUTCString(), START)).toBe(90);
    expect(parseRetryAfter('soon', START)).toBeUndefined();
    expect(parseRetryAfter('', START)).toBeUndefined();
    expect(parseRetryAfter(null, START)).toBeUndefined();
    expect(parseRetryAfter('-5', START)).toBe(1);
    expect(parseRetryAfter('0', START)).toBe(1);
});

test('a 429 pauses only the throttled account and counts down with time', () => {
    const seconds = recordThrottle(EMAIL, undefined, NO_JITTER);

    expect(seconds).toBe(60);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(60);
    expect(throttleWaitSeconds(OTHER_EMAIL, now)).toBeNull();

    now += 15_000;

    expect(throttleWaitSeconds(EMAIL, now)).toBe(45);
    expect(throttleWaitSeconds(OTHER_EMAIL, now)).toBeNull();
});

test('a Retry-After header wins and the backoff grows across separate pauses', () => {
    expect(recordThrottle(EMAIL, 42, () => 0)).toBe(42);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(42);

    recordSuccess(EMAIL);

    const waits = [
        nextThrottle(),
        nextThrottle(),
        nextThrottle(),
        nextThrottle(),
        nextThrottle(),
        nextThrottle(),
        nextThrottle()
    ];

    expect(waits).toEqual([60, 120, 240, 480, 960, 1800, 1800]);

    recordSuccess(EMAIL);
    expect(recordThrottle(EMAIL, 10_000)).toBe(THROTTLE_MAX_SECONDS);
    recordSuccess(EMAIL);
    expect(recordThrottle(EMAIL, 0)).toBe(1);
});

test('concurrent 429s keep one pause instead of multiplying it', () => {
    const waits = [recordThrottle(EMAIL, undefined, NO_JITTER)];

    for (const _ of [1, 2, 3]) waits.push(recordThrottle(EMAIL, undefined, NO_JITTER));

    expect(waits).toEqual([60, 60, 60, 60]);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(60);
});

test('a late short Retry-After cannot shorten a longer pause', () => {
    expect(recordThrottle(EMAIL, 1_800)).toBe(1_800);

    now += 60_000;

    expect(recordThrottle(EMAIL, 5)).toBe(1_740);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(1_740);
});

test('a success from a request that started before the pause does not clear it', () => {
    const startedAt = now - 1;
    recordThrottle(EMAIL, 60);

    recordSuccess(EMAIL, startedAt);

    expect(throttleWaitSeconds(EMAIL, now)).toBe(60);

    recordSuccess(EMAIL, now);

    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();
});

test('success clears the pause and the failure count', () => {
    recordThrottle(EMAIL, 300);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(300);

    recordSuccess(EMAIL);

    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();
    expect(recordThrottle(EMAIL, undefined, NO_JITTER)).toBe(60);
});

test('a 5xx burst starts at the base wait and counts separately from throttles', () => {
    for (let failure = 1; failure < THROTTLE_FAILURE_LIMIT; failure++)
        expect(recordServerFailure(EMAIL, NO_JITTER)).toBeNull();

    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();

    const wait = recordServerFailure(EMAIL, NO_JITTER);
    if (wait === null) throw new Error('Expected a pause.');

    expect(wait).toBe(60);
    expect(throttleWaitSeconds(EMAIL, now)).toBe(wait);

    now += wait * 1_000;
    recordServerSuccess(EMAIL);

    for (let failure = 1; failure < THROTTLE_FAILURE_LIMIT; failure++)
        expect(recordServerFailure(EMAIL, NO_JITTER)).toBeNull();

    expect(recordServerFailure(EMAIL, NO_JITTER)).toBe(60);
});

test('a non-5xx response breaks the 5xx streak', () => {
    recordServerFailure(EMAIL, NO_JITTER);
    recordServerFailure(EMAIL, NO_JITTER);
    recordServerSuccess(EMAIL);
    recordServerFailure(EMAIL, NO_JITTER);
    recordServerFailure(EMAIL, NO_JITTER);

    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();
    expect(recordServerFailure(EMAIL, NO_JITTER)).toBe(60);
});

test('guardedSend blocks Google calls while paused and reports the wait', async () => {
    recordThrottle(EMAIL, 30);

    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response('ok');
    };

    const result = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');
    const error = result.unwrapErr();

    expect(calls).toBe(0);
    expect(isThrottleError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 30 });
});

test('a 429 response pauses the account and returns the header wait', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 429, headers: { 'retry-after': '15' } });
    };

    const result = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');
    const error = result.unwrapErr();

    expect(calls).toBe(1);
    expect(error).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 15 });
    expect(throttleWaitSeconds(EMAIL, now)).toBe(15);
});

test('a successful response is returned unchanged and resets the breaker', async () => {
    recordServerFailure(EMAIL, NO_JITTER);
    recordServerFailure(EMAIL, NO_JITTER);

    const response = new Response('ok');
    const init: RequestInit = { method: 'POST', headers: { 'x-test': '1' }, body: 'payload' };
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: Fetcher = (input, receivedInit) => {
        calls.push({ url: String(input), init: receivedInit });

        return Promise.resolve(response);
    };

    const result = await guardedSend(EMAIL, fetcher, 'https://example.com/data', init, 'Test');

    expect(result.unwrap()).toBe(response);
    expect(calls).toEqual([{ url: 'https://example.com/data', init }]);
    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();
    expect(recordServerFailure(EMAIL, NO_JITTER)).toBeNull();
});

test('a single 5xx keeps the original error shape without pausing', async () => {
    const fetcher: Fetcher = async () => new Response(null, { status: 503 });

    const result = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');
    const error = result.unwrapErr();

    expect(error).toMatchObject({
        code: 'REQUEST_FAILED',
        message: 'Test failed (HTTP 503)',
        status: 503
    });
    expect(throttleWaitSeconds(EMAIL, now)).toBeNull();
});

test('the third consecutive 5xx through guardedSend pauses the account', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 503 });
    };

    const first = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');
    const second = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');
    const third = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');

    expect(first.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(second.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(third.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 60 });
    expect(calls).toBe(3);

    const blocked = await guardedSend(EMAIL, fetcher, 'https://example.com/data', {}, 'Test');

    expect(blocked.unwrapErr().code).toBe('THROTTLED');
    expect(calls).toBe(3);
});

test('send reports a 429 status and Retry-After without changing the message', async () => {
    const fetcher: Fetcher = async () =>
        new Response(null, { status: 429, headers: { 'retry-after': '12' } });

    const result = await send(fetcher, 'https://example.com/data', {}, 'Prepare download');
    const error = result.unwrapErr();

    expect(error).toMatchObject({
        code: 'REQUEST_FAILED',
        message: 'Prepare download failed (HTTP 429)',
        status: 429,
        retryAfterSeconds: 12
    });
});

test('jitter stays within twenty percent of the base backoff', () => {
    clearThrottleState();
    const low = recordThrottle(EMAIL, undefined, () => 0);
    clearThrottleState();
    const high = recordThrottle(EMAIL, undefined, () => 1);

    expect(low).toBe(48);
    expect(high).toBe(72);
});

test('a 5xx during an active pause returns the remaining wait without counting', () => {
    recordThrottle(EMAIL, 60);
    now += 10_000;

    expect(recordServerFailure(EMAIL, NO_JITTER)).toBe(50);

    now += 50_000;

    expect(recordServerFailure(EMAIL, NO_JITTER)).toBeNull();
    expect(recordServerFailure(EMAIL, NO_JITTER)).toBeNull();
    expect(recordServerFailure(EMAIL, NO_JITTER)).toBe(60);
});

test('throttle errors distinguish automatic retry from manual action', () => {
    expect(throttleError(120).message).toBe(
        'Google Photos is limiting requests, retrying in about 2 min'
    );
    expect(throttleError(120, 'manual').message).toBe(
        'Google Photos is limiting requests, try again in about 2 min'
    );
});
