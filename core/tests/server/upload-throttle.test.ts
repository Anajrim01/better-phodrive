import { afterEach, expect, test, vi } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { uploadBmpStream } from '@madkarmaa/phodrive-core/server/photos';
import {
    createThrottleCoordinator,
    type ThrottleCoordinator,
    type ThrottleScope
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { photosUploadHarness } from '../helpers/photos-harness';
import { TEST_ACCOUNT, uploadForm } from '../helpers/upload';

const ACCOUNT_KEY = 'account-a';

async function source(payload = 'throttled server upload') {
    const received = await receiveUpload(uploadForm(Buffer.from(payload)).request(), TEST_ACCOUNT);
    const input = received.unwrap();

    return { input, bmp: encodeUploadBmp(input) };
}

function scope(coordinator: ThrottleCoordinator): ThrottleScope {
    return { key: ACCOUNT_KEY, coordinator };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('a 429 at the Google boundary stores the full deadline and the next batch waits', async () => {
    const first = await source('first');
    const second = await source('second');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const coordinator = createThrottleCoordinator(() => 0);
    let throttledCalls = 0;
    const throttled: Fetcher = async () => {
        throttledCalls++;

        return new Response(null, { status: 429, headers: { 'retry-after': '1800' } });
    };

    const failed = await uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'first.bin',
        first.bmp,
        throttled,
        undefined,
        scope(coordinator)
    );

    expect(failed.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 1_800 });
    expect(throttledCalls).toBe(1);
    expect(coordinator.remaining(ACCOUNT_KEY)).toBe(1_800);
    await first.input.cancel();

    const harness = photosUploadHarness();
    let healthyCalls = 0;
    const healthy: Fetcher = (input, init) => {
        healthyCalls++;

        return harness.fetcher(input, init);
    };
    const uploading = uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'second.bin',
        second.bmp,
        healthy,
        undefined,
        scope(coordinator)
    );

    await vi.advanceTimersByTimeAsync(600_000);
    expect(healthyCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1_200_000);
    const uploaded = await uploading;

    expect(uploaded.isOk()).toBe(true);
    expect(healthyCalls).toBeGreaterThan(0);
    await second.input.cancel();
});

test('concurrent work for a paused account waits while another account proceeds', async () => {
    const first = await source('first');
    const sibling = await source('sibling');
    const other = await source('other');
    vi.useFakeTimers();

    const coordinator = createThrottleCoordinator(() => 0);
    const accountA = scope(coordinator);
    const accountB: ThrottleScope = { key: 'account-b', coordinator };
    const throttled: Fetcher = async () =>
        new Response(null, { status: 429, headers: { 'retry-after': '60' } });

    const failed = await uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'first.bin',
        first.bmp,
        throttled,
        undefined,
        accountA
    );
    expect(failed.unwrapErr()).toMatchObject({ code: 'THROTTLED' });
    await first.input.cancel();

    const aHarness = photosUploadHarness();
    let aCalls = 0;
    const aFetcher: Fetcher = (input, init) => {
        aCalls++;

        return aHarness.fetcher(input, init);
    };
    const bHarness = photosUploadHarness();
    let bCalls = 0;
    const bFetcher: Fetcher = (input, init) => {
        bCalls++;

        return bHarness.fetcher(input, init);
    };

    const aUpload = uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'sibling.bin',
        sibling.bmp,
        aFetcher,
        undefined,
        accountA
    );
    const bUpload = uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'other.bin',
        other.bmp,
        bFetcher,
        undefined,
        accountB
    );

    await vi.advanceTimersByTimeAsync(30_000);
    expect(aCalls).toBe(0);
    expect((await bUpload).isOk()).toBe(true);
    expect(bCalls).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect((await aUpload).isOk()).toBe(true);
    expect(aCalls).toBeGreaterThan(0);
    await sibling.input.cancel();
    await other.input.cancel();
});

test('cancelling during a known cooldown returns cancellation without a Google request', async () => {
    const pending = await source('cancelled');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

    const coordinator = createThrottleCoordinator(() => 0);
    coordinator.pause(ACCOUNT_KEY, 60);
    const controller = new AbortController();
    let calls = 0;
    const fetcher: Fetcher = async () => {
        calls++;

        return new Response(null, { status: 500 });
    };

    const uploading = uploadBmpStream(
        TEST_ACCOUNT.email,
        TEST_ACCOUNT.token,
        'cancelled.bin',
        pending.bmp,
        fetcher,
        controller.signal,
        scope(coordinator)
    );
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();

    expect((await uploading).unwrapErr()).toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(calls).toBe(0);
    await pending.input.cancel();
});
