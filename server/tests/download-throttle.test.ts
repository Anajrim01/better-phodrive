import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos';
import { GOOGLE_ACCOUNT_HEADER } from '@madkarmaa/phodrive-core/models';
import { requireSessionUser } from '../src/auth';
import { readGoogleAccount } from '../src/google';
import { ACCOUNT, USER, callWith, resolved } from './helpers/api';
import { testContext } from './helpers/context';
import { bmpResponse, downloadFixture } from '../../core/tests/helpers/download';
import { authResponse, downloadMetadata, imageDownload } from '../../core/tests/helpers/protobuf';

const { googleFetch } = vi.hoisted(() => ({ googleFetch: vi.fn<Fetcher>() }));

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/google', () => ({
    readGoogleAccount: vi.fn(),
    readGoogleEmail: vi.fn(),
    saveGoogleAccount: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/fetcher', () => ({
    photosFetch: googleFetch,
    photosFetchWithProgress: () => googleFetch
}));

const original = Buffer.from('route download throttle');
const data = downloadFixture(original, 'route.bin', [original]);
const chunk = data.input.chunks[0];
const signed = `https://lh3.googleusercontent.com/p/${chunk.mediaKey}=d`;
const prepared = downloadMetadata(
    chunk.mediaKey,
    Buffer.from(chunk.sha1, 'hex'),
    imageDownload(signed)
);

function google(throttledStage?: 'auth' | 'prepare' | 'media') {
    const calls = { auth: 0, prepare: 0, media: 0 };
    googleFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) {
            calls.auth++;

            return throttledStage === 'auth' && calls.auth === 1
                ? new Response(null, { status: 429, headers: { 'retry-after': '120' } })
                : authResponse();
        }
        if (url.includes('PhotosPrepareDownload')) {
            calls.prepare++;

            return throttledStage === 'prepare' && calls.prepare === 1
                ? new Response(null, { status: 429, headers: { 'retry-after': '120' } })
                : new Response(Uint8Array.from(prepared));
        }

        calls.media++;

        return throttledStage === 'media' && calls.media === 1
            ? new Response(null, { status: 429, headers: { 'retry-after': '120' } })
            : bmpResponse(data.bmps[0]);
    });

    return calls;
}

function post(
    context: ReturnType<typeof testContext>,
    path: string,
    body: unknown,
    accountId?: string
) {
    return callWith(context, path, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(accountId ? { [GOOGLE_ACCOUNT_HEADER]: accountId } : {})
        },
        body: JSON.stringify(body)
    });
}

function context() {
    const current = testContext();

    current.throttle = createThrottleCoordinator(() => 0);

    return current;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(readGoogleAccount).mockReturnValue(resolved(ACCOUNT));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

test('/api/chunk shares the stable account cooldown and does not contact Google while waiting', async () => {
    const current = context();
    const calls = google('auth');

    const first = await post(current, '/api/chunk', {
        mediaKey: chunk.mediaKey,
        sha1: chunk.sha1
    });

    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({
        error: expect.stringContaining('limiting requests')
    });
    expect(current.throttle.remaining(ACCOUNT.id)).toBe(120);
    expect(calls).toEqual({ auth: 1, prepare: 0, media: 0 });

    const retried = post(current, '/api/chunk', {
        mediaKey: chunk.mediaKey,
        sha1: chunk.sha1
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.auth).toBe(1);

    await vi.advanceTimersByTimeAsync(119_000);
    const response = await retried;

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(data.bmps[0]))).toBe(true);
    expect(calls).toEqual({ auth: 2, prepare: 1, media: 1 });
});

test('/api/chunk treats a media GET 429 as an account cooldown', async () => {
    const current = context();
    const calls = google('media');

    const response = await post(current, '/api/chunk', {
        mediaKey: chunk.mediaKey,
        sha1: chunk.sha1
    });

    expect(response.status).toBe(400);
    expect(current.throttle.remaining(ACCOUNT.id)).toBe(120);
    expect(calls).toEqual({ auth: 1, prepare: 1, media: 1 });
});

test('/api/files uses the selected owner account and leaves another account unaffected', async () => {
    vi.mocked(readGoogleAccount).mockImplementation((_db, _userId, accountId) =>
        resolved(accountId === 'owner-b' ? { ...ACCOUNT, id: 'owner-b' } : ACCOUNT)
    );
    const current = context();
    const calls = google('prepare');
    const body = {
        action: 'download',
        name: data.input.name,
        fileHash: data.input.fileHash,
        fileId: data.input.fileId,
        chunks: data.input.chunks
    };

    const owner = await post(current, '/api/files', body, 'owner-b');

    expect(owner.status).toBe(400);
    expect(current.throttle.remaining('owner-b')).toBe(120);
    expect(current.throttle.remaining(ACCOUNT.id)).toBe(0);
    expect(calls).toEqual({ auth: 1, prepare: 1, media: 0 });

    const defaultAccount = await post(current, '/api/files', body);

    expect(defaultAccount.status).toBe(200);
    expect(Buffer.from(await defaultAccount.arrayBuffer()).equals(original)).toBe(true);
    expect(calls).toEqual({ auth: 2, prepare: 2, media: 1 });
});
