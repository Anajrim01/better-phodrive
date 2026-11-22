import { afterEach, expect, test, vi } from 'vitest';
import type {
    ShareDownloadWorkerReply,
    ShareDownloadWorkerRequest
} from '#browser/share-download-protocol';
import {
    createShareDownloadWorker,
    removeStaleShareDownloads
} from '#browser/share-download-worker-client';
import { fileOf, PAYLOAD } from '../helpers/share-download';

afterEach(() => vi.unstubAllGlobals());

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;

function temporaries(entries: Record<string, number>, locked: readonly string[] = []) {
    const removed: string[] = [];
    const directory = {
        keys: async function* () {
            yield* Object.keys(entries);
        },
        getFileHandle: async (name: string) => ({
            getFile: async () => new File([], name, { lastModified: entries[name] })
        }),
        removeEntry: async (name: string) => {
            if (locked.includes(name))
                throw new DOMException('Locked', 'NoModificationAllowedError');
            removed.push(name);
        }
    };

    return { removed, storage: { getDirectory: async () => directory } };
}

test('stale cleanup removes only old temporaries this feature created', async () => {
    const { removed, storage } = temporaries({
        'phodrive-share-old': NOW - DAY,
        'phodrive-share-recent': NOW - DAY + 1,
        'other-old-file': NOW - DAY * 30,
        'not-phodrive-share-old': NOW - DAY * 30
    });
    vi.stubGlobal('navigator', { storage });

    await removeStaleShareDownloads(NOW);

    expect(removed).toEqual(['phodrive-share-old']);
});

test('a locked temporary does not stop the rest of the cleanup', async () => {
    const { removed, storage } = temporaries(
        { 'phodrive-share-locked': NOW - DAY, 'phodrive-share-old': NOW - DAY },
        ['phodrive-share-locked']
    );
    vi.stubGlobal('navigator', { storage });

    await removeStaleShareDownloads(NOW);

    expect(removed).toEqual(['phodrive-share-old']);
});

test('a new download runs the cleanup and survives it failing', async () => {
    const { removed, storage } = temporaries({ 'phodrive-share-old': 0 });
    vi.stubGlobal('Worker', function () {
        return Object.assign(new EventTarget(), { terminate: vi.fn(), postMessage: vi.fn() });
    });

    vi.stubGlobal('navigator', { storage });
    expect((await createShareDownloadWorker()).isOk()).toBe(true);
    expect(removed).toEqual(['phodrive-share-old']);

    vi.stubGlobal('navigator', {
        storage: { getDirectory: () => Promise.reject(new Error('unavailable')) }
    });
    expect((await createShareDownloadWorker()).isOk()).toBe(true);

    vi.stubGlobal('navigator', {});
    expect((await createShareDownloadWorker()).isOk()).toBe(true);
});

test('reactive file metadata is cloneable at the worker boundary', async () => {
    let copied: ShareDownloadWorkerRequest | undefined;
    const fake = Object.assign(new EventTarget(), {
        terminate: vi.fn(),
        postMessage: (message: ShareDownloadWorkerRequest) => {
            copied = structuredClone(message);
            queueMicrotask(() =>
                fake.dispatchEvent(new MessageEvent('message', { data: { kind: 'opened' } }))
            );
        }
    });
    vi.stubGlobal('Worker', function () {
        return fake;
    });
    const client = (await createShareDownloadWorker()).unwrap();
    const file = new Proxy(fileOf(PAYLOAD), {});

    const opened = await client.open(file, { kind: 'automatic' });

    expect(opened.isOk()).toBe(true);
    expect(copied).toEqual({ kind: 'open', file: fileOf(PAYLOAD), name: expect.any(String) });
});

test('the worker discards its open sink before replying to a failed write', async () => {
    const close = vi.fn();
    const removeEntry = vi.fn(async () => {});
    vi.stubGlobal('navigator', {
        storage: {
            getDirectory: async () => ({
                getFileHandle: async () => ({
                    createSyncAccessHandle: async () => ({
                        write: () => {
                            throw new DOMException('Full', 'QuotaExceededError');
                        },
                        close,
                        flush: vi.fn()
                    })
                }),
                removeEntry
            })
        }
    });
    let pending: ((reply: ShareDownloadWorkerReply) => void) | undefined;
    const scope = Object.assign(new EventTarget(), {
        postMessage: (message: ShareDownloadWorkerReply) => {
            const current = pending;
            pending = undefined;
            current?.(message);
        }
    });
    vi.stubGlobal('self', scope);
    await import('#browser/share-download-worker');
    function send(message: ShareDownloadWorkerRequest): Promise<ShareDownloadWorkerReply> {
        return new Promise((resolve) => {
            pending = resolve;
            scope.dispatchEvent(new MessageEvent('message', { data: message }));
        });
    }
    expect((await send({ kind: 'open', file: fileOf(PAYLOAD), name: 'owned-temp' })).kind).toBe(
        'opened'
    );
    expect((await send({ kind: 'append', bytes: PAYLOAD })).kind).toBe('failed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(removeEntry).toHaveBeenCalledExactlyOnceWith('owned-temp');
    expect((await send({ kind: 'abort' })).kind).toBe('aborted');
    expect(removeEntry).toHaveBeenCalledTimes(1);
});

test('a worker that dies while idle fails the next request instead of hanging', async () => {
    const removeEntry = vi.fn(async () => {});
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({ removeEntry }) } });
    const fake = Object.assign(new EventTarget(), {
        terminate: vi.fn(),
        postMessage: vi.fn(() => {
            queueMicrotask(() =>
                fake.dispatchEvent(new MessageEvent('message', { data: { kind: 'opened' } }))
            );
        })
    });
    vi.stubGlobal('Worker', function () {
        return fake;
    });
    const client = (await createShareDownloadWorker()).unwrap();
    expect((await client.open(fileOf(PAYLOAD), { kind: 'automatic' })).isOk()).toBe(true);
    fake.dispatchEvent(new Event('error'));
    expect((await client.append(PAYLOAD)).unwrapErr().code).toBe('DOWNLOAD_SAVE_FAILED');
    expect((await client.abort()).isOk()).toBe(true);
    expect(removeEntry).toHaveBeenCalledTimes(1);
});
