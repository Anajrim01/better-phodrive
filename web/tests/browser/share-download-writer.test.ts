import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { Ok, type AsyncResult } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFile } from '@madkarmaa/phodrive-core/models';
import { ShareDownloadWriter, type ShareDownloadSink } from '#browser/share-download-writer';

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

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

function memorySink() {
    const writes: { offset: number; bytes: Uint8Array }[] = [];
    let closed = false;
    let discarded = false;

    const done = (): AsyncResult<void, ApplicationError> =>
        Ok(undefined).andThenAsync(async () => Ok(undefined));

    const sink: ShareDownloadSink = {
        write: (bytes, offset) => {
            writes.push({ offset, bytes: bytes.slice() });

            return done();
        },
        close: () => {
            closed = true;

            return done();
        },
        discard: () => {
            discarded = true;

            return done();
        },
        completion: () => ({ kind: 'saved' })
    };

    return {
        sink,
        writes,
        get closed() {
            return closed;
        },
        get discarded() {
            return discarded;
        }
    };
}

test('blocks are hashed, written at increasing offsets, and closed', async () => {
    const payload = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const memory = memorySink();
    const writer = await ShareDownloadWriter.start(fileOf(payload), memory.sink).unwrap();

    await writer.append(Uint8Array.from([1, 2, 3])).unwrap();
    await writer.append(Uint8Array.from([4, 5, 6])).unwrap();

    const finished = await writer.finish();

    expect(finished.unwrap()).toEqual({ kind: 'saved' });
    expect(memory.writes.map((write) => write.offset)).toEqual([0, 3]);
    expect(memory.writes.map((write) => [...write.bytes])).toEqual([
        [1, 2, 3],
        [4, 5, 6]
    ]);
    expect(memory.closed).toBe(true);
});

test('a mismatched file hash discards the output', async () => {
    const payload = Uint8Array.from([1, 2, 3]);
    const memory = memorySink();
    const writer = await ShareDownloadWriter.start(
        fileOf(payload, 'a'.repeat(64)),
        memory.sink
    ).unwrap();

    await writer.append(payload).unwrap();
    const finished = await writer.finish();

    expect(finished.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
    expect(memory.discarded).toBe(true);
    expect(memory.closed).toBe(false);
});

test('a short file is refused before it can be saved', async () => {
    const memory = memorySink();
    const writer = await ShareDownloadWriter.start(
        fileOf(Uint8Array.from([1, 2, 3, 4])),
        memory.sink
    ).unwrap();

    await writer.append(Uint8Array.from([1, 2])).unwrap();
    const finished = await writer.finish();

    expect(finished.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
    expect(memory.discarded).toBe(true);
});

test('a block beyond the declared size is refused', async () => {
    const memory = memorySink();
    const writer = await ShareDownloadWriter.start(
        fileOf(Uint8Array.from([1, 2, 3])),
        memory.sink
    ).unwrap();

    const appended = await writer.append(Uint8Array.from([1, 2, 3, 4]));

    expect(appended.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');

    await writer.abort().unwrap();
    expect(memory.discarded).toBe(true);
    expect(memory.writes).toHaveLength(0);
});

test('an empty file verifies against the empty SHA-256', async () => {
    const memory = memorySink();
    const writer = await ShareDownloadWriter.start(
        fileOf(new Uint8Array(), EMPTY_HASH),
        memory.sink
    ).unwrap();

    const finished = await writer.finish();

    expect(finished.unwrap()).toEqual({ kind: 'saved' });
    expect(memory.writes).toHaveLength(0);
    expect(memory.closed).toBe(true);
});
