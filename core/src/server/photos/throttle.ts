import { Err, Ok, type AsyncResult } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';

export const THROTTLE_BASE_SECONDS = 60;
export const THROTTLE_MAX_SECONDS = 1_800;
export const THROTTLE_JITTER_RATIO = 0.2;
export const THROTTLE_FAILURE_LIMIT = 3;
export const THROTTLE_RESUME_JITTER_MS = 5_000;

type State = {
    failures: number;
    serverFailures: number;
    pausedUntil: number;
    pausedAt: number;
};

/** One cooldown per account, shared by every Google request made for that account. */
export interface ThrottleCoordinator {
    /** Extend one account's cooldown and return the remaining whole seconds. */
    pause: (account: string, retryAfterSeconds?: number) => number;
    /** Wait for the account cooldown, with a small per-waiter resume jitter. */
    wait: (account: string, signal?: AbortSignal) => Promise<void>;
    /** Remaining cooldown in whole seconds, or zero when the account is clear. */
    remaining: (account: string) => number;
    /** Count a server failure and return a cooldown once the failure limit is reached. */
    serverFailure: (account: string) => number | null;
    serverSuccess: (account: string) => void;
    /** Clear the whole state only when this request started after the latest pause, not with it. */
    success: (account: string, startedAt: number) => void;
    clear: (account?: string) => void;
}

/** A Google request scope: the stable account key and its shared coordinator. */
export interface ThrottleScope {
    key: string;
    coordinator: ThrottleCoordinator;
    /** Aborts cooldown waits as well as the request they gate. */
    signal?: AbortSignal;
    onWait?: (retryAfterSeconds: number) => void;
}

function abortError(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException('Upload cancelled', 'AbortError');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));

            return;
        }

        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reject(abortError(signal!));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

export function createThrottleCoordinator(random: () => number = Math.random): ThrottleCoordinator {
    const states = new Map<string, State>();

    const stateFor = (account: string): State => {
        const existing = states.get(account);
        if (existing) return existing;

        const state: State = { failures: 0, serverFailures: 0, pausedUntil: 0, pausedAt: 0 };
        states.set(account, state);

        return state;
    };

    const remaining = (account: string): number => {
        const state = states.get(account);
        if (!state) return 0;

        const milliseconds = state.pausedUntil - Date.now();
        if (milliseconds > 0) return Math.max(1, Math.ceil(milliseconds / 1_000));

        if (state.failures === 0 && state.serverFailures === 0) states.delete(account);

        return 0;
    };

    const backoffSeconds = (failures: number): number => {
        const base = Math.min(
            THROTTLE_BASE_SECONDS * 2 ** (Math.max(1, failures) - 1),
            THROTTLE_MAX_SECONDS
        );
        const jitter = 1 + (random() * 2 - 1) * THROTTLE_JITTER_RATIO;

        return Math.min(Math.max(Math.round(base * jitter), 1), THROTTLE_MAX_SECONDS);
    };

    return {
        pause(account, retryAfterSeconds) {
            const state = stateFor(account);
            state.serverFailures = 0;

            const headerWait = validSeconds(retryAfterSeconds);
            const active = state.pausedUntil > Date.now();
            if (!active) state.failures += 1;

            const calculated = headerWait ?? backoffSeconds(Math.max(1, state.failures));
            const elapsed = active ? Math.ceil((state.pausedUntil - Date.now()) / 1_000) : 0;
            const seconds = Math.max(elapsed, calculated);

            if (!active) state.pausedAt = Date.now();
            state.pausedUntil = Date.now() + seconds * 1_000;

            return seconds;
        },

        async wait(account, signal) {
            while (true) {
                const state = states.get(account);
                if (!state) return;

                const milliseconds = state.pausedUntil - Date.now();
                if (milliseconds <= 0) {
                    if (state.failures === 0 && state.serverFailures === 0) states.delete(account);

                    return;
                }

                if (signal?.aborted) throw abortError(signal);

                await delay(
                    milliseconds + Math.floor(random() * THROTTLE_RESUME_JITTER_MS),
                    signal
                );
            }
        },

        remaining,

        serverFailure(account) {
            const state = stateFor(account);
            const paused = state.pausedUntil - Date.now();
            if (paused > 0) return Math.max(1, Math.ceil(paused / 1_000));

            state.serverFailures += 1;
            if (state.serverFailures < THROTTLE_FAILURE_LIMIT) return null;

            const level = state.serverFailures - THROTTLE_FAILURE_LIMIT + 1;
            const seconds = backoffSeconds(level);
            state.pausedAt = Date.now();
            state.pausedUntil = Date.now() + seconds * 1_000;

            return seconds;
        },

        serverSuccess(account) {
            const state = states.get(account);
            if (state) state.serverFailures = 0;
        },

        success(account, startedAt) {
            const state = states.get(account);
            if (!state) return;
            if (state.pausedAt > 0 && startedAt <= state.pausedAt) return;

            states.delete(account);
        },

        clear(account) {
            if (account === undefined) states.clear();
            else states.delete(account);
        }
    };
}

/** Wait for a known cooldown and report it once, so the upload UI can show a waiting state. */
export function waitForThrottle(
    scope: ThrottleScope,
    signal?: AbortSignal
): AsyncResult<void, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const active = signal ?? scope.signal;
        const seconds = scope.coordinator.remaining(scope.key);
        if (seconds > 0) scope.onWait?.(seconds);

        try {
            await scope.coordinator.wait(scope.key, active);

            return active?.aborted ? Err(SERVER_ERRORS.UPLOAD_CANCELLED) : Ok(undefined);
        } catch {
            return Err(SERVER_ERRORS.UPLOAD_CANCELLED);
        }
    });
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
    if (value === null) return undefined;

    const text = value.trim();
    if (!text) return undefined;

    if (/^-?\d+(\.\d+)?$/.test(text)) {
        const seconds = Number(text);

        return Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : undefined;
    }

    const date = Date.parse(text);
    if (Number.isNaN(date)) return undefined;

    return Math.max(1, Math.ceil((date - now) / 1_000));
}

export function throttleError(seconds: number): ServerError {
    const wait = Math.min(Math.max(Math.round(seconds), 1), THROTTLE_MAX_SECONDS);

    return {
        code: 'THROTTLED',
        message: `Google Photos is limiting requests. Retry in ${waitMessage(wait)}.`,
        retryAfterSeconds: wait
    };
}

function validSeconds(seconds: number | undefined): number | null {
    if (seconds === undefined || !Number.isFinite(seconds)) return null;

    return Math.min(Math.max(Math.ceil(seconds), 1), THROTTLE_MAX_SECONDS);
}

function waitMessage(seconds: number): string {
    if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

    const minutes = Math.ceil(seconds / 60);

    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** Process-wide coordinator for direct uploads that have no server context. */
export const defaultThrottle = createThrottleCoordinator();
