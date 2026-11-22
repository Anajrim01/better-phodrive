import { beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type Result } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { PublicShare } from '@madkarmaa/phodrive-core/models';
import type { ShareDownloadOutcome, ShareDownloadTarget } from '#browser/share-download-protocol';
import { asyncOk, fileOf, PAYLOAD } from '../helpers/share-download';

const { get, pick, download, offer } = vi.hoisted(() => ({
    get: vi.fn(),
    pick: vi.fn(),
    download: vi.fn(),
    offer: vi.fn()
}));
vi.mock('#browser/shares', () => ({ getPublicShare: get }));
vi.mock('#browser/share-download', () => ({
    pickShareDownloadTarget: pick,
    downloadShareFile: download,
    offerShareDownload: offer
}));
const { PublicShareViewer } = await import('#browser/share-viewer.svelte');

function share(name: string): PublicShare {
    return {
        name,
        kind: 'file',
        createdAt: '2026-11-06T00:00:00.000Z',
        files: [{ ...fileOf(PAYLOAD), id: name, name: `${name}.bin` }]
    };
}

function pending<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function pendingResult<T>() {
    const gate = pending<Result<T, ApplicationError>>();
    return { ...gate, result: Ok(undefined).andThenAsync(() => gate.promise) };
}

beforeEach(() => {
    vi.resetAllMocks();
    get.mockImplementation((token: string) => asyncOk(share(token)));
    pick.mockReturnValue(asyncOk({ kind: 'automatic' }));
    download.mockReturnValue(asyncOk({ kind: 'saved' }));
});

test('same-route token changes reset the old manifest and all browsing/download state', async () => {
    const viewer = new PublicShareViewer();
    await viewer.load('A');
    expect(viewer.manifest?.name).toBe('A');
    viewer.folder = 'old-folder';
    viewer.error = 'old error';
    viewer.downloadError = 'old download error';
    viewer.progress = { done: 1, total: 2 };
    const next = pendingResult<PublicShare>();
    get.mockReturnValueOnce(next.result);
    const loaded = viewer.load('B');
    expect(viewer.manifest).toBeNull();
    expect(viewer.loading).toBe(true);
    expect(viewer.folder).toBe('');
    expect(viewer.error).toBe('');
    expect(viewer.downloadError).toBe('');
    expect(viewer.progress).toEqual({ done: 0, total: 0 });
    expect(get.mock.calls[0]?.[1].aborted).toBe(true);
    next.resolve(Ok(share('B')));
    await loaded;
    expect(viewer.manifest?.files[0]?.id).toBe('B');
    expect(viewer.loading).toBe(false);
});

test.each(['success', 'failure'])(
    'a late %s from the previous token cannot replace the new share',
    async (kind) => {
        const viewer = new PublicShareViewer();
        const old = pendingResult<PublicShare>();
        get.mockReturnValueOnce(old.result);
        const loadingOld = viewer.load('A');
        await viewer.load('B');
        old.resolve(
            kind === 'success'
                ? Ok(share('A'))
                : Err({ code: 'REQUEST_FAILED', message: 'Old failure' })
        );
        await loadingOld;
        expect(viewer.manifest?.name).toBe('B');
        expect(viewer.error).toBe('');
    }
);

test('accepting a deferred picker after unmount starts no network transfer', async () => {
    const viewer = new PublicShareViewer();
    await viewer.load('A');
    const picker = pendingResult<ShareDownloadTarget>();
    pick.mockReturnValueOnce(picker.result);
    const task = viewer.download(share('A').files[0]!);
    viewer.dispose();
    picker.resolve(Ok({ kind: 'automatic' }));
    await task;
    expect(download).not.toHaveBeenCalled();
    expect(offer).not.toHaveBeenCalled();
});

test('an old picker cannot start a transfer or clear a newer token download', async () => {
    const viewer = new PublicShareViewer();
    await viewer.load('A');
    const old = pendingResult<ShareDownloadTarget>();
    const next = pendingResult<ShareDownloadTarget>();
    pick.mockReturnValueOnce(old.result).mockReturnValueOnce(next.result);
    const oldTask = viewer.download(share('A').files[0]!);
    await viewer.load('B');
    const nextTask = viewer.download(share('B').files[0]!);
    old.resolve(Ok({ kind: 'automatic' }));
    await oldTask;
    expect(viewer.downloading).toBe('B');
    expect(download).not.toHaveBeenCalled();
    next.resolve(Ok({ kind: 'automatic' }));
    await nextTask;
    expect(download).toHaveBeenCalledExactlyOnceWith(
        'B',
        share('B').files[0],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(offer).toHaveBeenCalledExactlyOnceWith({ kind: 'saved' }, 'B.bin');
});

test('token navigation aborts an active download and releases a late OPFS result', async () => {
    const viewer = new PublicShareViewer();
    await viewer.load('A');
    const transfer = pendingResult<ShareDownloadOutcome>();
    const started = pending<void>();
    download.mockImplementation(() => {
        started.resolve();
        return transfer.result;
    });
    const task = viewer.download(share('A').files[0]!);
    await started.promise;
    const options = download.mock.calls[0]?.[2];
    await viewer.load('B');
    expect(options.signal.aborted).toBe(true);
    options.onProgress(8, 9);
    expect(viewer.progress).toEqual({ done: 0, total: 0 });
    const release = vi.fn(() => asyncOk(undefined));
    transfer.resolve(Ok({ kind: 'file', file: new File([], 'old.bin'), release }));
    await task;
    expect(release).toHaveBeenCalledTimes(1);
    expect(offer).not.toHaveBeenCalled();
    expect(viewer.manifest?.name).toBe('B');
    expect(viewer.downloading).toBe('');
});
