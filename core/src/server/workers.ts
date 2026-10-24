import { availableParallelism } from 'node:os';
import type { Result } from 'results-ts';
import { z } from 'zod';
import type { ApplicationError } from '../errors';
import { schemaResult } from '../validation';

/** Outside the browser, concurrency is bounded by the processors this process may use now. */
export function maxWorkers(): number {
    return availableParallelism();
}

/** Requests may ask for more workers than this machine has; use at most one per processor. */
export function limitWorkers(workers: number): number {
    return Math.min(workers, maxWorkers());
}

export function validateWorkers(workers: number): Result<number, ApplicationError> {
    const max = maxWorkers();

    return schemaResult(
        z.int().min(1).max(max),
        workers,
        `Concurrent workers must be a whole number from 1 to ${max}.`
    ).mapErr(({ message }) => ({ code: 'INVALID_CONCURRENT_WORKERS', message }) as const);
}
