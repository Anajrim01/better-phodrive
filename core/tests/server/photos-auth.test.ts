import { expect, test } from 'vitest';
import { authenticatedHeaders } from '@madkarmaa/phodrive-core/server/photos/auth';
import { validateAasAccount } from '@madkarmaa/phodrive-core/server/photos';
import {
    recordThrottle,
    throttleWaitSeconds
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { guardedSend } from '@madkarmaa/phodrive-core/server/photos/transport';
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

test('a rejected bearer clears the cached headers', async () => {
    let authCalls = 0;
    const authFetcher: Fetcher = async () => {
        authCalls++;

        return new Response(AUTH_RESPONSE);
    };

    await authenticatedHeaders(EMAIL, TOKEN, authFetcher);

    const rejected: Fetcher = async () => new Response(null, { status: 401 });
    const result = await guardedSend(EMAIL, rejected, 'https://photos.example/data', {}, 'Photos');

    expect(result.unwrapErr()).toMatchObject({ code: 'REQUEST_FAILED', status: 401 });

    const refreshed = await authenticatedHeaders(EMAIL, TOKEN, authFetcher);

    expect(refreshed.isOk()).toBe(true);
    expect(authCalls).toBe(2);
});

test('headers inside the expiry margin are not reused', async () => {
    let calls = 0;
    const shortExpiry = `Auth=bearer\nExpiry=${Math.floor(Date.now() / 1000) + 20}`;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(shortExpiry);
    };

    await authenticatedHeaders(EMAIL, TOKEN, fetcher);
    await authenticatedHeaders(EMAIL, TOKEN, fetcher);

    expect(calls).toBe(2);
});

test('accounts do not share cached headers', async () => {
    const tokens: string[] = [];
    const fetcher: Fetcher = async (_input, init) => {
        const form = new URLSearchParams(String(init?.body));
        tokens.push(form.get('Token') ?? '');

        return new Response(AUTH_RESPONSE);
    };

    await authenticatedHeaders('a@example.com', 'aas_et/a', fetcher);
    await authenticatedHeaders('b@example.com', 'aas_et/b', fetcher);
    await authenticatedHeaders('a@example.com', 'aas_et/a', fetcher);
    await authenticatedHeaders('b@example.com', 'aas_et/b', fetcher);

    expect(tokens).toEqual(['aas_et/a', 'aas_et/b']);
});
