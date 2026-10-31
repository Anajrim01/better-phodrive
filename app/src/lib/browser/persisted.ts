import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { PersistedState } from 'runed';
import { Err, Ok, type Result } from 'results-ts';

export const STORAGE_UNAVAILABLE = {
    code: 'STORAGE_UNAVAILABLE',
    message: 'Browser storage is unavailable. Enable it to save your preferences.'
} as const satisfies ApplicationError;

/** Runed's default parser logs raw values on malformed JSON, which could expose credentials. */
export function parseStoredJson(raw: string): Result<unknown, ApplicationError> {
    try {
        const value: unknown = JSON.parse(raw);

        return Ok(value);
    } catch {
        return Err({
            code: 'INVALID_STORED_JSON',
            message: 'Browser storage contains invalid JSON.'
        } as const);
    }
}

export function readStoredJson(raw: string): unknown {
    return parseStoredJson(raw).unwrapOr(undefined);
}

export function readState<T>(state: PersistedState<T>): Result<T, ApplicationError> {
    try {
        return Ok(state.current);
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }
}

/** Runed catches write failures internally, so verify persistence before reporting success. */
export function writeState<T>(state: PersistedState<T>, value: T): Result<void, ApplicationError> {
    try {
        state.current = value;
    } catch {
        return Err(STORAGE_UNAVAILABLE);
    }

    return readState(state).andThen((saved) =>
        JSON.stringify(saved) === JSON.stringify(value) ? Ok(undefined) : Err(STORAGE_UNAVAILABLE)
    );
}

export function resetState<T>(
    state: PersistedState<T | null | undefined>
): Result<void, ApplicationError> {
    return readState(state).andThen((previous) => {
        // Runed ignores removal events. Publish an unset marker so other tabs update too.
        const unset = writeState(state, null);
        if (unset.isErr()) return unset;

        try {
            try {
                state.disconnect();
                state.current = undefined;
            } finally {
                state.connect();
            }
        } catch {
            return writeState(state, previous).andThen(() => Err(STORAGE_UNAVAILABLE));
        }

        return readState(state).andThen((saved) =>
            saved === undefined ? Ok(undefined) : Err(STORAGE_UNAVAILABLE)
        );
    });
}
