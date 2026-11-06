import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';
import type {
    ShareDownloadFileHandle,
    ShareDownloadStorage,
    ShareDownloadSyncAccessHandle,
    ShareDownloadWritable
} from '#browser/share-download-protocol';
import {
    ShareDownloadWriter,
    createShareDownloadSink,
    type ShareDownloadSink
} from '#browser/share-download-writer';

function fileOf(payload: Uint8Array, fileHash?: string): ShareFile {
    return {
        id: 'share-file-id',
        fileHash: fileHash ?? createHash('sha256').update(payload).digest('hex'),
        name: 'file.bin',
        relativeFolder: '',
        chunkCount: 1,
        size: payload.length
    };
}

function fakeAccess() {
    const writes: { offset: number; bytes: Uint8Array }[] = [];
    let closed = false;

    const access: ShareDownloadSyncAccessHandle = {
        write: (buffer, options) => {
            const bytes = ArrayBuffer.isView(buffer)
                ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
                : new Uint8Array(buffer);
            writes.push({ offset: options?.at ?? 0, bytes: bytes.slice() });

            return bytes.byteLength;
        },
        flush: vi.fn(),
        close: () => {
            closed = true;
        }
    };

    return {
        access,
        writes,
        get closed() {
            return closed;
        }
    };
}

function fakeHandle(access: ShareDownloadSyncAccessHandle): ShareDownloadFileHandle {
    return {
        getFile: async () => new File([], 'temp'),
        createSyncAccessHandle: async () => access,
        createWritable: async () => {
            throw new Error('not used');
        }
    };
}

function pickedHandle(writable: ShareDownloadWritable): ShareDownloadFileHandle {
    return {
        getFile: async () => new File([], 'picked'),
        createSyncAccessHandle: async () => {
            throw new Error('not used');
        },
        createWritable: async () => writable
    };
}

function done(): AsyncResult<void, ApplicationError> {
    return Ok(undefined).andThenAsync(async () => Ok(undefined));
}

test('without OPFS the download cannot store an automatic file', async () => {
    const sink = await createShareDownloadSink(null, 'temp.bin', undefined);

    expect(sink.unwrapErr().code).toBe('STORAGE_UNAVAILABLE');
});

test('the OPFS sink writes at byte offsets and removes its temporary', async () => {
    const fake = fakeAccess();
    const handle = fakeHandle(fake.access);
    const removeEntry = vi.fn(async () => {});
    const storage: ShareDownloadStorage = {
        getDirectory: async () => ({
            getFileHandle: async () => handle,
            removeEntry
        })
    };

    const sink = await createShareDownloadSink(null, 'temp.bin', storage).unwrap();

    await sink.write(Uint8Array.from([1, 2]), 0).unwrap();
    await sink.write(Uint8Array.from([3]), 2).unwrap();
    await sink.close().unwrap();

    expect(fake.writes.map((write) => write.offset)).toEqual([0, 2]);
    expect(fake.closed).toBe(true);
    expect(sink.completion()).toEqual({ kind: 'handle', handle });

    await sink.discard().unwrap();
    expect(removeEntry).toHaveBeenCalledWith('temp.bin');
});

test('a picked file is written through a direct writable', async () => {
    const writable: ShareDownloadWritable = {
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {})
    };
    const sink = await createShareDownloadSink(
        pickedHandle(writable),
        'temp.bin',
        undefined
    ).unwrap();

    await sink.write(Uint8Array.from([1]), 0).unwrap();
    await sink.close().unwrap();

    expect(writable.write).toHaveBeenCalledTimes(1);
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(sink.completion()).toEqual({ kind: 'saved' });
});

test('a hash mismatch never commits a picked destination', async () => {
    const payload = Uint8Array.from([1, 2, 3]);
    const writable: ShareDownloadWritable = {
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {})
    };

    const sink = await createShareDownloadSink(
        pickedHandle(writable),
        'temp.bin',
        undefined
    ).unwrap();
    const writer = await ShareDownloadWriter.start(fileOf(payload, 'a'.repeat(64)), sink).unwrap();

    await writer.append(payload).unwrap();
    const finished = await writer.finish();

    expect(finished.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
    expect(writable.close).not.toHaveBeenCalled();
    expect(writable.abort).toHaveBeenCalledTimes(1);
});

test('a failed close discards the stored output', async () => {
    const payload = Uint8Array.from([1, 2, 3]);
    let discarded = false;

    const sink: ShareDownloadSink = {
        write: () => done(),
        close: () =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'DOWNLOAD_SAVE_FAILED',
                    message: 'Could not save the downloaded file.'
                } satisfies ApplicationError)
            ),
        discard: () => {
            discarded = true;

            return done();
        },
        completion: () => ({ kind: 'saved' })
    };

    const writer = await ShareDownloadWriter.start(fileOf(payload), sink).unwrap();

    await writer.append(payload).unwrap();
    const finished = await writer.finish();

    expect(finished.unwrapErr().code).toBe('DOWNLOAD_SAVE_FAILED');
    expect(discarded).toBe(true);
});

test('a temporary that cannot be locked is removed', async () => {
    const removeEntry = vi.fn(async () => {});
    const handle: ShareDownloadFileHandle = {
        getFile: async () => new File([], 'temp'),
        createSyncAccessHandle: async () => {
            throw new DOMException('no lock', 'NotSupportedError');
        },
        createWritable: async () => {
            throw new Error('not used');
        }
    };
    const storage: ShareDownloadStorage = {
        getDirectory: async () => ({
            getFileHandle: async () => handle,
            removeEntry
        })
    };

    const sink = await createShareDownloadSink(null, 'temp.bin', storage);

    expect(sink.unwrapErr().code).toBe('STORAGE_UNAVAILABLE');
    expect(removeEntry).toHaveBeenCalledWith('temp.bin');
});
