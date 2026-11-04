import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { UploadJob } from '@madkarmaa/phodrive-core/browser/upload/jobs';
import { transferFiles } from '@madkarmaa/phodrive-core/browser/upload';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    createThrottleCoordinator,
    type ThrottleCoordinator
} from '@madkarmaa/phodrive-core/server/photos/throttle';
import { localChunkTransport } from '@madkarmaa/phodrive-core/node/upload';
import { UploadJobStatus } from '@madkarmaa/phodrive-core/models';
import { photosUploadHarness } from '../helpers/photos-harness';
import { TEST_ACCOUNT } from '../helpers/upload';

const ACCOUNT_KEY = 'account-a';

function throttlingFetcher(limit: number, coordinator: ThrottleCoordinator) {
    const harness = photosUploadHarness();
    let authCalls = 0;
    const fetcher: Fetcher = (input, init) => {
        if (String(input).includes('android.googleapis.com/auth')) {
            authCalls++;
            if (authCalls <= limit)
                return Promise.resolve(
                    new Response(null, { status: 429, headers: { 'retry-after': '60' } })
                );
        }

        return harness.fetcher(input, init);
    };

    return { fetcher, authCalls: () => authCalls, coordinator };
}

async function upload(
    fetcher: Fetcher,
    coordinator: ThrottleCoordinator,
    options: { signal?: AbortSignal } = {}
) {
    const jobs: UploadJob[] = [];
    const chunks: string[] = [];
    const uploading = transferFiles(
        [new File(['throttle me'], 'throttle.bin')],
        TEST_ACCOUNT.email,
        1,
        (job) => jobs.push(job),
        (chunk) => chunks.push(chunk.fileId),
        localChunkTransport(TEST_ACCOUNT, {
            fetcher,
            accountId: ACCOUNT_KEY,
            coordinator,
            signal: options.signal
        }),
        options.signal
    );

    return { uploading, jobs, chunks };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

test('a throttled chunk waits on the server deadline before its second request', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    const google = throttlingFetcher(1, coordinator);
    const { uploading, jobs, chunks } = await upload(google.fetcher, coordinator);

    await vi.waitFor(() => expect(google.authCalls()).toBe(1));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(google.authCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(google.authCalls()).toBe(2));
    await uploading;

    expect(google.authCalls()).toBe(2);
    expect(chunks).toHaveLength(1);
    expect(jobs.at(-1)).toMatchObject({ status: UploadJobStatus.Complete });
});

test('the fourth real throttled attempt fails the file and still records the cooldown', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    const google = throttlingFetcher(Number.POSITIVE_INFINITY, coordinator);
    const { uploading, jobs } = await upload(google.fetcher, coordinator);

    await vi.waitFor(() => expect(google.authCalls()).toBe(1));
    for (let attempt = 1; attempt < 4; attempt++) {
        await vi.advanceTimersByTimeAsync(60_000);
        await vi.waitFor(() => expect(google.authCalls()).toBe(attempt + 1));
    }
    await uploading;

    expect(google.authCalls()).toBe(4);
    expect(jobs.at(-1)).toMatchObject({ status: UploadJobStatus.Error });
    expect(jobs.at(-1)?.message).toContain('limiting requests');
    expect(coordinator.remaining(ACCOUNT_KEY)).toBeGreaterThan(0);
});

test('cancelling a cooldown wait prevents the next Google request', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    const google = throttlingFetcher(Number.POSITIVE_INFINITY, coordinator);
    const controller = new AbortController();
    const { uploading, jobs } = await upload(google.fetcher, coordinator, {
        signal: controller.signal
    });

    await vi.waitFor(() => expect(google.authCalls()).toBe(1));
    await vi.advanceTimersByTimeAsync(10_000);
    controller.abort();
    await uploading;

    expect(jobs.at(-1)).toMatchObject({
        status: UploadJobStatus.Error,
        message: 'Upload cancelled.'
    });

    await vi.advanceTimersByTimeAsync(600_000);
    expect(google.authCalls()).toBe(1);
});

test('an already-cancelled upload never starts a Google request', async () => {
    const coordinator = createThrottleCoordinator(() => 0);
    const google = throttlingFetcher(Number.POSITIVE_INFINITY, coordinator);
    const controller = new AbortController();
    controller.abort();
    const { uploading, jobs } = await upload(google.fetcher, coordinator, {
        signal: controller.signal
    });

    await uploading;

    expect(google.authCalls()).toBe(0);
    expect(jobs.at(-1)).toMatchObject({
        status: UploadJobStatus.Error,
        message: 'Upload cancelled.'
    });
});
