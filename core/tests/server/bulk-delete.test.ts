import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { BULK_TRASH_BATCH_SIZE, deleteFiles } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import { EMAIL, file, input } from '../helpers/bulk-delete';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

let folder = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-delete-'));
    clearLibraryState();
    configureLibraryState(join(folder, 'library-state.json'));
    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => Ok(undefined))
    );
});

afterEach(async () => {
    configureLibraryState(null);
    clearLibraryState();
    vi.clearAllMocks();
    await rm(folder, { recursive: true, force: true });
});
import { createHash } from 'node:crypto';

test('trash keys are batched across files and each file is reported once', async () => {
    const first = file('first.bin', 500);
    const second = file('second.bin', 1);
    const results: { name: string; deleted: number; error?: string }[] = [];

    const deleted = await deleteFiles(input([first, second]), (result) => {
        results.push({
            name: result.name,
            deleted: result.deleted.length,
            ...(result.error ? { error: result.error } : {})
        });
    });

    expect(deleted.isOk()).toBe(true);
    expect(vi.mocked(moveToTrashBatch).mock.calls.map((call) => call[2].length)).toEqual([
        BULK_TRASH_BATCH_SIZE,
        1
    ]);
    expect(results).toEqual([
        { name: 'first.bin', deleted: 500 },
        { name: 'second.bin', deleted: 1 }
    ]);
});

test('a file split across batches is reported only after every chunk is confirmed', async () => {
    const first = file('first.bin', BULK_TRASH_BATCH_SIZE);
    const second = file('second.bin', 2);
    const results: string[] = [];

    await deleteFiles(input([first, second]), (result) => {
        results.push(result.name);
        expect(result.deleted).toHaveLength(result.name === 'first.bin' ? 500 : 2);
    });

    expect(results).toEqual(['first.bin', 'second.bin']);
});

test('a failed batch falls back to per-key requests for later files', async () => {
    const first = file('first.bin', 500);
    const second = file('second.bin', 1);
    const results: { name: string; deleted: number; error?: string }[] = [];

    vi.mocked(moveToTrashBatch)
        .mockImplementationOnce(() => Ok(undefined).andThenAsync(async () => Ok(undefined)))
        .mockImplementationOnce(() =>
            Ok(undefined).andThenAsync(async () =>
                Err({
                    code: 'REQUEST_FAILED',
                    message: 'Delete failed',
                    status: 400
                } as const)
            )
        );

    await deleteFiles(input([first, second]), (result) => {
        results.push({
            name: result.name,
            deleted: result.deleted.length,
            ...(result.error ? { error: result.error } : {})
        });
    });

    expect(results).toEqual([
        { name: 'first.bin', deleted: 500 },
        { name: 'second.bin', deleted: 1 }
    ]);
});

test('fallback emits a completed file before unrelated retries finish', async () => {
    const first = file('first.bin', 1);
    const second = file('second.bin', 1);
    const results: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    vi.mocked(moveToTrashBatch).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Batch rejected', status: 400 } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation((_email, _token, sha1) =>
        Ok(undefined).andThenAsync(async () => {
            if (sha1 === second.chunks[0].sha1) await gate;

            return Ok(undefined);
        })
    );

    const pending = deleteFiles({ ...input([first, second]), workers: 1 }, (result) => {
        results.push(result.name);
    });

    await vi.waitFor(() => expect(results).toEqual(['first.bin']));
    release();
    await pending;
    expect(results).toEqual(['first.bin', 'second.bin']);
});

test('confirmed chunks are marked in the local library state per batch', async () => {
    const first = file('first.bin', 500);
    const second = file('second.bin', 1);
    const hash = createHash('sha256').update('first.bin').digest('hex');
    const items = [...first.chunks, ...second.chunks].map((chunk) => ({
        ...chunk,
        fileHash: hash,
        fileId: hash,
        chunkIndex: 0,
        isLast: true,
        size: 1,
        at: 1
    }));
    writeAccountState(EMAIL, {
        syncToken: Buffer.from('sync'),
        revision: 3,
        items: new Map(items.map((item) => [item.mediaKey, item])),
        log: []
    });

    await deleteFiles(input([first, second]), () => {});

    const state = readAccountState(EMAIL);
    expect(state?.revision).toBe(5);
    expect(state?.items.get('first.bin-0')?.trashedAt).toEqual(expect.any(Number));
    expect(state?.items.get('second.bin-0')?.trashedAt).toEqual(expect.any(Number));
});

test('1711 single-chunk files use four provider requests', async () => {
    const files = Array.from({ length: 1711 }, (_, index) => file(`file-${index}.bin`, 1));
    let completed = 0;

    await deleteFiles(input(files), (result) => {
        completed++;
        expect(result.error).toBeUndefined();
    });

    expect(vi.mocked(moveToTrashBatch).mock.calls.map((call) => call[2].length)).toEqual([
        500, 500, 500, 211
    ]);
    expect(completed).toBe(1711);
});
