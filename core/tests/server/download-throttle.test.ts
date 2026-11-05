import { afterEach, expect, test, vi } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { bmpResponse, downloadFixture } from '../helpers/download';
import { authResponse, downloadMetadata, imageDownload } from '../helpers/protobuf';

const { googleFetch } = vi.hoisted(() => ({ googleFetch: vi.fn<Fetcher>() }));

vi.mock('@madkarmaa/phodrive-core/server/fetcher', () => ({
    photosFetch: googleFetch,
    photosFetchWithProgress: () => googleFetch
}));

const ACCOUNT = { email: 'test@example.com', token: 'aas_et/test' };
const ACCOUNT_KEY = 'account-a';
const OTHER_KEY = 'account-b';

afterEach(() => {
    vi.useRealTimers();
    googleFetch.mockReset();
});

function fixture(parts?: number) {
    const original = Buffer.from('download throttle fixture');
    const data = downloadFixture(
        original,
        'download.bin',
        parts === 1 ? [original] : [original.subarray(0, 6), original.subarray(6)]
    );
    const signed = (chunk: RemoteBmp) => `https://lh3.googleusercontent.com/p/${chunk.mediaKey}=d`;

    return {
        ...data,
        signed,
        metadata: (chunk: RemoteBmp) =>
            downloadMetadata(
                chunk.mediaKey,
                Buffer.from(chunk.sha1, 'hex'),
                imageDownload(signed(chunk))
            )
    };
}

function tooManyRequests() {
    return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
}

function googleFetcher(
    data: ReturnType<typeof fixture>,
    throttledStage?: 'auth' | 'prepare' | 'media'
) {
    const calls = { auth: 0, prepare: 0, media: 0 };
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) {
            calls.auth++;

            return throttledStage === 'auth' && calls.auth === 1
                ? tooManyRequests()
                : authResponse();
        }
        if (url.includes('PhotosPrepareDownload')) {
            calls.prepare++;
            if (throttledStage === 'prepare' && calls.prepare === 1) return tooManyRequests();

            const request = Buffer.from(await new Response(init?.body).arrayBuffer());
            const chunk = data.input.chunks.find((candidate) =>
                request.includes(Buffer.from(candidate.mediaKey))
            );
            if (!chunk) throw new Error('Missing media key');

            return new Response(Uint8Array.from(data.metadata(chunk)));
        }

        calls.media++;
        if (throttledStage === 'media' && calls.media === 1) return tooManyRequests();
        const chunk = data.input.chunks.find((candidate) => url === data.signed(candidate));
        if (!chunk) throw new Error('Unexpected media URL');

        return bmpResponse(data.bmps[chunk.chunkIndex]);
    };

    return { fetcher, calls };
}

function google(data: ReturnType<typeof fixture>, throttledStage?: 'auth' | 'prepare' | 'media') {
    const created = googleFetcher(data, throttledStage);
    googleFetch.mockReset();
    googleFetch.mockImplementation(created.fetcher);

    return { fetcher: googleFetch, calls: created.calls };
}

function scope(key = ACCOUNT_KEY, coordinator = createThrottleCoordinator(() => 0)) {
    return { key, coordinator };
}

test.each(['auth', 'prepare', 'media'] as const)(
    'a %s 429 records the account cooldown',
    async (stage) => {
        const data = fixture(1);
        const throttle = scope();
        const googleCall = google(data, stage);

        const result = await downloadBmp(
            ACCOUNT.email,
            ACCOUNT.token,
            data.input.chunks[0].mediaKey,
            data.input.chunks[0].sha1,
            googleCall.fetcher,
            undefined,
            throttle
        );

        expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });
        expect(throttle.coordinator.remaining(ACCOUNT_KEY)).toBe(120);
        expect(googleCall.calls).toEqual({
            auth: 1,
            prepare: stage === 'auth' ? 0 : 1,
            media: stage === 'media' ? 1 : 0
        });
    }
);

test('a same-account download waits for the cooldown while another account proceeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const data = fixture(1);
    const coordinator = createThrottleCoordinator(() => 0);
    const first = googleFetcher(data, 'auth');

    const failed = await downloadBmp(
        ACCOUNT.email,
        ACCOUNT.token,
        data.input.chunks[0].mediaKey,
        data.input.chunks[0].sha1,
        first.fetcher,
        undefined,
        scope(ACCOUNT_KEY, coordinator)
    );
    expect(failed.unwrapErr()).toMatchObject({ code: 'THROTTLED' });
    expect(coordinator.remaining(ACCOUNT_KEY)).toBe(120);

    const waiting = googleFetcher(data);
    const sameAccount = downloadBmp(
        ACCOUNT.email,
        ACCOUNT.token,
        data.input.chunks[0].mediaKey,
        data.input.chunks[0].sha1,
        waiting.fetcher,
        undefined,
        scope(ACCOUNT_KEY, coordinator)
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(waiting.calls).toEqual({ auth: 0, prepare: 0, media: 0 });

    const other = googleFetcher(data);
    const otherResult = await downloadBmp(
        ACCOUNT.email,
        ACCOUNT.token,
        data.input.chunks[0].mediaKey,
        data.input.chunks[0].sha1,
        other.fetcher,
        undefined,
        scope(OTHER_KEY, coordinator)
    );
    expect(otherResult.isOk()).toBe(true);
    expect(other.calls).toEqual({ auth: 1, prepare: 1, media: 1 });

    await vi.advanceTimersByTimeAsync(119_000);
    expect((await sameAccount).isOk()).toBe(true);
    expect(waiting.calls).toEqual({ auth: 1, prepare: 1, media: 1 });
});

test('a scope-only cancellation aborts an in-flight Google request', async () => {
    const data = fixture(1);
    const coordinator = createThrottleCoordinator(() => 0);
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const fetcher: Fetcher = (_input, init) => {
        received = init?.signal ?? undefined;
        if (!received) return Promise.reject(new Error('Missing request signal'));

        return new Promise((_resolve, reject) => {
            received?.addEventListener('abort', () => reject(new Error('Aborted')), {
                once: true
            });
        });
    };

    const pending = downloadBmp(
        ACCOUNT.email,
        ACCOUNT.token,
        data.input.chunks[0].mediaKey,
        data.input.chunks[0].sha1,
        fetcher,
        undefined,
        { key: ACCOUNT_KEY, coordinator, signal: controller.signal }
    );
    await vi.waitFor(() => expect(received).toBe(controller.signal));

    controller.abort();

    expect((await pending).unwrapErr()).toEqual(SERVER_ERRORS.UPLOAD_CANCELLED);
});

test('cancelling a streamed download during its cooldown wait never reaches Google', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const data = fixture(1);
    const coordinator = createThrottleCoordinator(() => 0);
    coordinator.pause(ACCOUNT_KEY, 60);
    const googleCall = google(data);
    const abort = new AbortController();

    const downloading = downloadFile(data.input, abort.signal, scope(ACCOUNT_KEY, coordinator));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(googleCall.calls).toEqual({ auth: 0, prepare: 0, media: 0 });

    abort.abort();
    expect((await downloading).unwrapErr()).toEqual(SERVER_ERRORS.UPLOAD_CANCELLED);
    expect(googleCall.calls).toEqual({ auth: 0, prepare: 0, media: 0 });
});

test('cancelling while a later chunk waits for cooldown never contacts Google for that chunk', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const data = fixture();
    const coordinator = createThrottleCoordinator(() => 0);
    const googleCall = google(data);
    const abort = new AbortController();
    const downloaded = await downloadFile(
        data.input,
        abort.signal,
        scope(ACCOUNT_KEY, coordinator)
    );
    const reader = downloaded.unwrap().body!.getReader();
    let received = 0;
    while (received < data.input.chunks[0].size) {
        const next = await reader.read();
        if (next.done) break;
        received += next.value.length;
    }

    coordinator.pause(ACCOUNT_KEY, 60);
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(googleCall.calls.auth).toBe(1);

    abort.abort();
    await expect(pending).rejects.toEqual(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
    expect(googleCall.calls.auth).toBe(1);
});

test('a single-chunk server download uses the account scope and preserves the bytes', async () => {
    const data = fixture(1);
    const googleCall = google(data);
    const coordinator = createThrottleCoordinator(() => 0);

    const downloaded = await downloadFile(data.input, undefined, scope(ACCOUNT_KEY, coordinator));
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(data.original)).toBe(true);
    expect(googleCall.calls).toEqual({ auth: 1, prepare: 1, media: 1 });
});

test('a multi-chunk server download shares the account scope for every chunk', async () => {
    const data = fixture();
    const googleCall = google(data);
    const coordinator = createThrottleCoordinator(() => 0);

    const downloaded = await downloadFile(data.input, undefined, scope(ACCOUNT_KEY, coordinator));
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(data.original)).toBe(true);
    expect(googleCall.calls).toEqual({ auth: 2, prepare: 2, media: 2 });
});
