import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
    PAYLOAD,
    asyncOk,
    fileOf,
    payloadResponse,
    rateLimited,
    requestFailed,
    session
} from '../helpers/share-download';

const { chunk, createWorker, worker } = vi.hoisted(() => {
    const worker = {
        open: vi.fn(),
        append: vi.fn(),
        finish: vi.fn(),
        abort: vi.fn()
    };

    return { chunk: vi.fn(), createWorker: vi.fn(), worker };
});

vi.mock('#browser/shares', () => ({ getShareChunk: chunk }));
vi.mock('#browser/share-download-worker-client', () => ({
    createShareDownloadWorker: createWorker
}));

const { downloadShareFile } = await import('#browser/share-download');

function prepare() {
    createWorker.mockReturnValue(asyncOk(worker));
    worker.open.mockReturnValue(asyncOk(undefined));
    worker.append.mockReturnValue(asyncOk(undefined));
    worker.abort.mockReturnValue(asyncOk(undefined));
    worker.finish.mockReturnValue(asyncOk({ kind: 'saved' }));
}

beforeEach(() => {
    vi.resetAllMocks();
    prepare();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

test('a rate-limited capability request is retried without refetching bytes', async () => {
    chunk.mockReturnValueOnce(rateLimited(0));
    chunk.mockReturnValue(session(0, PAYLOAD));

    const fetchMock = vi.fn(async () => payloadResponse(PAYLOAD));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrap()).toEqual({ kind: 'saved' });
    expect(chunk).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.append).toHaveBeenCalledTimes(1);
    expect(worker.open).toHaveBeenCalledTimes(1);
});

test('the retry waits for the advertised delay', async () => {
    vi.useFakeTimers();
    chunk.mockReturnValueOnce(rateLimited(2));
    chunk.mockReturnValue(session(0, PAYLOAD));
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => payloadResponse(PAYLOAD))
    );

    const pending = downloadShareFile('token', fileOf(PAYLOAD));
    await vi.advanceTimersByTimeAsync(0);

    expect(chunk).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(chunk).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.unwrap()).toEqual({ kind: 'saved' });
    expect(chunk).toHaveBeenCalledTimes(2);
});

test('a rate-limit wait is interrupted by cancellation', async () => {
    vi.useFakeTimers();
    chunk.mockReturnValue(rateLimited(60));

    const controller = new AbortController();
    const pending = downloadShareFile('token', fileOf(PAYLOAD), {
        signal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(chunk).toHaveBeenCalledTimes(1);

    controller.abort();
    const result = await pending;

    expect(result.unwrapErr().message).toBe('The download was cancelled.');
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(worker.abort).toHaveBeenCalledTimes(1);
});

test('rate-limit retries stop at the attempt cap', async () => {
    chunk.mockReturnValue(rateLimited(0));

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrapErr().code).toBe('REQUEST_FAILED');
    expect(chunk).toHaveBeenCalledTimes(6);
    expect(worker.abort).toHaveBeenCalledTimes(1);
});

test('non-rate-limit request failures are not retried', async () => {
    chunk.mockReturnValue(requestFailed(409));

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrapErr()).toMatchObject({ status: 409 });
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(worker.abort).toHaveBeenCalledTimes(1);
});

test('a retry continues after the chunks already written', async () => {
    const first = PAYLOAD.slice(0, 5);
    const second = PAYLOAD.slice(5);
    let secondAttempts = 0;

    chunk.mockImplementation((_token, _fileId, index) => {
        if (index === 0) return session(0, first, 2);

        secondAttempts++;

        return secondAttempts === 1 ? rateLimited(0) : session(1, second, 2);
    });

    const fetchMock = vi
        .fn()
        .mockImplementationOnce(async () => payloadResponse(first))
        .mockImplementationOnce(async () => payloadResponse(second));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadShareFile('token', fileOf(PAYLOAD, 2));

    expect(result.unwrap()).toEqual({ kind: 'saved' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(worker.append).toHaveBeenCalledTimes(2);
});
