import { expect, test } from 'vitest';
import { authenticatedHeaders } from '@madkarmaa/phodrive-core/server/photos/auth';
import { validateAasAccount } from '@madkarmaa/phodrive-core/server/photos';
import {
    recordThrottle,
    throttleWaitSeconds
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';

const EMAIL = 'auth@example.com';
const TOKEN = 'aas_et/auth';
const AUTH_RESPONSE = `Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 3600}`;

test('authentication headers are reused until they expire', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(AUTH_RESPONSE);
    };

    const first = await authenticatedHeaders(EMAIL, TOKEN, fetcher);
    const second = await authenticatedHeaders(EMAIL, TOKEN, fetcher);

    expect(first.unwrap()).toEqual(second.unwrap());
    expect(calls).toBe(1);
});

test('a paused account does not authenticate', async () => {
    recordThrottle(EMAIL, 30);

    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(AUTH_RESPONSE);
    };

    const result = await authenticatedHeaders(EMAIL, TOKEN, fetcher);

    expect(calls).toBe(0);
    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 30 });
});

test('a 429 during authentication pauses the account', async () => {
    const fetcher: Fetcher = async () =>
        new Response(null, { status: 429, headers: { 'retry-after': '12' } });

    const result = await authenticatedHeaders(EMAIL, TOKEN, fetcher);

    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 12 });
    expect(throttleWaitSeconds(EMAIL)).toBe(12);
});

test('account validation always asks Google again', async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(AUTH_RESPONSE);
    };

    await authenticatedHeaders(EMAIL, TOKEN, fetcher);
    const validated = await validateAasAccount(EMAIL, TOKEN, fetcher);

    expect(validated.isOk()).toBe(true);
    expect(calls).toBe(2);
});
