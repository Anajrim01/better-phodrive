import { mkdir, stat } from 'node:fs/promises';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { CliError } from './context';

export function isMissingPath(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Whether a path is a folder, or null when nothing exists there yet. */
export function inspectFolder(path: string): AsyncResult<boolean | null, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            const stats = await stat(path);

            return Ok(stats.isDirectory());
        } catch (error) {
            if (isMissingPath(error)) return Ok(null);

            return Err({ code: 'INVALID_OPTION', message: `Could not read ${path}.` } as const);
        }
    });
}

export function createFolder(path: string): AsyncResult<void, CliError> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            await mkdir(path, { recursive: true });

            return Ok(undefined);
        } catch {
            return Err({ code: 'INVALID_OPTION', message: `Could not create ${path}.` } as const);
        }
    });
}
