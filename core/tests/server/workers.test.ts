import { availableParallelism } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { deleteFile } from '@madkarmaa/phodrive-core/server/files';
import { moveToTrash } from '@madkarmaa/phodrive-core/server/photos';
import { limitWorkers, validateWorkers } from '@madkarmaa/phodrive-core/server/workers';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { downloadFixture } from '../helpers/download';

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();

    return { ...actual, availableParallelism: vi.fn(actual.availableParallelism) };
});
vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({ moveToTrash: vi.fn() }));

afterEach(() => vi.clearAllMocks());

test('the worker limit follows the processors available at call time', () => {
    vi.mocked(availableParallelism).mockReturnValue(4);
    expect(limitWorkers(32)).toBe(4);
    expect(validateWorkers(4).unwrap()).toBe(4);
    expect(validateWorkers(5).unwrapErr()).toEqual({
        code: 'INVALID_CONCURRENT_WORKERS',
        message: 'Concurrent workers must be a whole number from 1 to 4.'
    });

    vi.mocked(availableParallelism).mockReturnValue(64);
    expect(limitWorkers(48)).toBe(48);
    expect(validateWorkers(48).unwrap()).toBe(48);
});

test('server deletes run at most one request per processor', async () => {
    vi.mocked(availableParallelism).mockReturnValue(2);
    const parts = Array.from({ length: 6 }, (_, index) => Buffer.from([index]));
    const { input } = downloadFixture(Buffer.concat(parts), 'proof.bin', parts);
    let active = 0;
    let busiest = 0;
    vi.mocked(moveToTrash).mockImplementation(() =>
        Ok(undefined).andThenAsync(async () => {
            active++;
            busiest = Math.max(busiest, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;

            return Ok(undefined);
        })
    );

    const deleted = await deleteFile({ ...input, action: FileActionKind.Delete, workers: 32 });

    expect(deleted.unwrap().deleted).toHaveLength(6);
    expect(busiest).toBe(2);
});
