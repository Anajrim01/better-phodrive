import { availableParallelism } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { limitWorkers, validateWorkers } from '@madkarmaa/phodrive-core/server/workers';

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:os')>();

    return { ...actual, availableParallelism: vi.fn(actual.availableParallelism) };
});

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
