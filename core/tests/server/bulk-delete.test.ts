import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import {
    BULK_TRASH_BATCH_SIZE,
    deleteFiles,
    validateBulkDelete
} from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash, moveToTrashBatch } from '@madkarmaa/phodrive-core/server/photos';
import {
    clearLibraryState,
    configureLibraryState,
    readAccountState,
    writeAccountState
} from '@madkarmaa/phodrive-core/server/photos/library/state';
import type { BulkDeleteFile, BulkDeleteRequest } from '@madkarmaa/phodrive-core/bulk-delete';

vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    moveToTrash: vi.fn(),
    moveToTrashBatch: vi.fn()
}));

const EMAIL = 'test@example.com';
let folder = '';
let statePath = '';

beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'phodrive-bulk-delete-'));
    statePath = join(folder, 'library-state.json');
    clearLibraryState();
    configureLibraryState(statePath);
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

function chunk(name: string, index: number) {
    return {
        mediaKey: `${name}-${index}`,
        sha1: createHash('sha1').update(`${name}-${index}`).digest('hex')
    };
}

function file(name: string, count: number): BulkDeleteFile {
    return {
        name,
        chunks: Array.from({ length: count }, (_, index) => chunk(name, index))
    };
}

function input(files: BulkDeleteFile[]): BulkDeleteRequest {
    return { email: EMAIL, token: 'aas_et/test', workers: 2, files };
}

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
                Err({ code: 'REQUEST_FAILED', message: 'Delete failed' } as const)
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

test('a rejected batch retries each key and keeps confirmed chunks', async () => {
    const first = file('first.bin', 3);
    const results: { deleted: number; error?: string }[] = [];
    let active = 0;
    let peak = 0;

    vi.mocked(moveToTrashBatch).mockImplementationOnce(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Batch rejected', status: 400 } as const)
        )
    );
    vi.mocked(moveToTrash).mockImplementation((_email, _token, sha1) =>
        Ok(undefined).andThenAsync(async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 2));
            active--;

            return sha1 === first.chunks[1].sha1
                ? Err({ code: 'REQUEST_FAILED', message: 'Single key failed' } as const)
                : Ok(undefined);
        })
    );

    await deleteFiles(input([first]), (result) => {
        results.push({
            deleted: result.deleted.length,
            ...(result.error ? { error: result.error } : {})
        });
    });

    expect(moveToTrash).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);
    expect(results).toEqual([{ deleted: 2, error: 'Single key failed' }]);
});

test('a throttled batch uses manual retry wording and keeps the wait', async () => {
    const results: { error?: string; retryAfterSeconds?: number }[] = [];

    vi.mocked(moveToTrashBatch).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'THROTTLED',
                message: 'Google Photos is limiting requests',
                retryAfterSeconds: 7
            } as const)
        )
    );

    await deleteFiles(
        input([file('first.bin', 1), file('second.bin', 1)]),
        (result) => {
            results.push({
                ...(result.error ? { error: result.error } : {}),
                ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {})
            });
        },
        'manual'
    );

    expect(results).toEqual([
        { error: expect.stringContaining('try again'), retryAfterSeconds: 7 },
        { error: expect.stringContaining('try again'), retryAfterSeconds: 7 }
    ]);
    expect(moveToTrash).not.toHaveBeenCalled();
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

test('invalid bulk metadata is rejected before any provider request', async () => {
    const invalid = validateBulkDelete(input([{ ...file('first.bin', 1), chunks: [] }]));
    const result = await deleteFiles(input([{ ...file('first.bin', 1), chunks: [] }]), () => {});

    expect(invalid.isErr()).toBe(true);
    expect(result.isErr()).toBe(true);
    expect(vi.mocked(moveToTrashBatch)).not.toHaveBeenCalled();
});
