import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { INTEGRITY_FAILED } from '@madkarmaa/phodrive-core/browser/chunk-verifier';
import type { ShareDownloadTarget } from '#browser/share-download-protocol';
import {
    EMPTY_HASH,
    PAYLOAD,
    asyncErr,
    asyncOk,
    fileOf,
    payloadResponse,
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

const { downloadShareFile, offerShareDownload, pickShareDownloadTarget } =
    await import('#browser/share-download');

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

test('a network rejection leaves the download retryable', async () => {
    chunk.mockReturnValue(session(0, PAYLOAD));

    let attempts = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
            attempts++;
            if (attempts === 1) throw new TypeError('network down');

            return payloadResponse(PAYLOAD);
        })
    );

    const failed = await downloadShareFile('token', fileOf(PAYLOAD));
    expect(failed.unwrapErr().code).toBe('DOWNLOAD_RECEIVE_FAILED');
    expect(worker.abort).toHaveBeenCalledTimes(1);

    const retried = await downloadShareFile('token', fileOf(PAYLOAD));
    expect(retried.unwrap()).toEqual({ kind: 'saved' });
    expect(attempts).toBe(2);

    vi.unstubAllGlobals();
});

test('a payload that fails the worker hash is refused', async () => {
    chunk.mockReturnValue(session(0, PAYLOAD));
    worker.finish.mockReturnValue(asyncErr(INTEGRITY_FAILED));
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => payloadResponse(PAYLOAD))
    );

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
    expect(worker.abort).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
});

test('chunk metadata that disagrees with the manifest stops before fetching', async () => {
    chunk.mockReturnValue(session(1, PAYLOAD));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.abort).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
});

test('an empty file is verified and saved without a request', async () => {
    const empty = new Uint8Array();
    chunk.mockReturnValue(session(0, empty));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadShareFile('token', {
        ...fileOf(empty),
        fileHash: EMPTY_HASH
    });

    expect(result.unwrap()).toEqual({ kind: 'saved' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.append).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
});

test('every streamed block is written in order', async () => {
    const payload = new Uint8Array(200_000);

    for (let index = 0; index < payload.length; index++) payload[index] = index % 251;

    const first = payload.slice(0, 100_000);
    const second = payload.slice(100_000);
    chunk.mockReturnValueOnce(session(0, first, 2));
    chunk.mockReturnValueOnce(session(1, second, 2));
    vi.stubGlobal(
        'fetch',
        vi
            .fn()
            .mockImplementationOnce(async () => payloadResponse(first))
            .mockImplementationOnce(async () => payloadResponse(second))
    );

    const result = await downloadShareFile('token', fileOf(payload, 2));

    expect(result.unwrap()).toEqual({ kind: 'saved' });

    const appended = worker.append.mock.calls.reduce(
        (total: number, [bytes]) => total + bytes.byteLength,
        0
    );
    expect(appended).toBe(payload.length);

    vi.unstubAllGlobals();
});

test('a failing write aborts the worker download', async () => {
    chunk.mockReturnValue(session(0, PAYLOAD));
    worker.append.mockReturnValue(
        asyncErr({
            code: 'DOWNLOAD_SAVE_FAILED',
            message: 'Could not save the downloaded file.'
        })
    );
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => payloadResponse(PAYLOAD))
    );

    const result = await downloadShareFile('token', fileOf(PAYLOAD));

    expect(result.unwrapErr().code).toBe('DOWNLOAD_SAVE_FAILED');
    expect(worker.abort).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
});

test('an aborted signal stops before the worker opens a file', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await downloadShareFile('token', fileOf(PAYLOAD), {
        signal: controller.signal
    });

    expect(result.unwrapErr().code).toBe('DOWNLOAD_RECEIVE_FAILED');
    expect(worker.open).not.toHaveBeenCalled();
    expect(worker.abort).toHaveBeenCalledTimes(1);
});

test('a supported picker asks for a destination before the download', async () => {
    const handle = { name: 'retry.bin' };
    const showSaveFilePicker = vi.fn(async () => handle);
    vi.stubGlobal('window', { showSaveFilePicker });

    const target = await pickShareDownloadTarget('retry.bin').unwrap();

    expect(target).toEqual({ kind: 'picker', handle });
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'retry.bin' });

    vi.unstubAllGlobals();
});

test('a cancelled picker ends the download quietly', async () => {
    vi.stubGlobal('window', {
        showSaveFilePicker: vi.fn(async () => {
            throw new DOMException('cancelled', 'AbortError');
        })
    });

    const target = await pickShareDownloadTarget('retry.bin').unwrap();

    expect(target).toEqual({ kind: 'cancelled' } satisfies ShareDownloadTarget);

    vi.unstubAllGlobals();
});

test('a browser without the picker falls back to an automatic download', async () => {
    vi.stubGlobal('window', {});
    worker.open.mockReturnValue(Ok(undefined));

    const target = await pickShareDownloadTarget('retry.bin').unwrap();

    expect(target).toEqual({ kind: 'automatic' });

    vi.unstubAllGlobals();
});

test('cancellation during the reader aborts the worker', async () => {
    chunk.mockReturnValue(session(0, PAYLOAD));

    const controller = new AbortController();
    let reads = 0;

    const body = new ReadableStream<Uint8Array>({
        pull(stream) {
            reads++;

            if (reads === 1) {
                stream.enqueue(PAYLOAD.slice(0, 5));

                return;
            }

            controller.abort();
            stream.error(new DOMException('cancelled', 'AbortError'));
        }
    });

    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(body, {
                    status: 206,
                    headers: {
                        'content-range': `bytes 0-${PAYLOAD.length - 1}/${PAYLOAD.length}`
                    }
                })
        )
    );

    const result = await downloadShareFile('token', fileOf(PAYLOAD), {
        signal: controller.signal
    });

    expect(result.unwrapErr().message).toBe('The download was cancelled.');
    expect(worker.abort).toHaveBeenCalledTimes(1);
});

test('an offered file keeps its OPFS entry and object URL however long the save takes', async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click }) });
    const create = vi
        .spyOn(URL, 'createObjectURL')
        .mockReturnValueOnce('blob:first')
        .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const release = vi.fn(() => asyncOk(undefined));
    const outcome = { kind: 'file', file: new File([], 'a.bin'), release } as const;

    offerShareDownload(outcome, 'a.bin');
    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60_000);

    expect(click).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();

    offerShareDownload(outcome, 'b.bin');

    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
    expect(release).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    create.mockRestore();
    revoke.mockRestore();
});
