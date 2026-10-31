export const THROTTLE_BASE_SECONDS = 60;
export const THROTTLE_MAX_SECONDS = 1_800;
export const THROTTLE_JITTER_RATIO = 0.2;
export const THROTTLE_FAILURE_LIMIT = 3;

type ThrottleState = {
    failures: number;
    serverFailures: number;
    pausedUntil: number;
    pausedAt: number;
};

const states = new Map<string, ThrottleState>();

export function throttleWaitSeconds(email: string, now = Date.now()): number | null {
    const state = states.get(email);
    if (!state) return null;

    const remaining = state.pausedUntil - now;
    if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000));

    if (state.failures === 0 && state.serverFailures === 0) states.delete(email);

    return null;
}

export function recordThrottle(
    email: string,
    retryAfterSeconds?: number,
    random: () => number = Math.random,
    now = Date.now()
): number {
    const state = stateFor(email);
    state.serverFailures = 0;

    const headerWait = validSeconds(retryAfterSeconds);
    const active = state.pausedUntil > now;
    if (!active) state.failures += 1;

    const calculated = headerWait ?? backoffSeconds(Math.max(1, state.failures), random);
    const remaining = active ? Math.ceil((state.pausedUntil - now) / 1000) : 0;
    const seconds = Math.max(remaining, calculated);

    if (!active) state.pausedAt = now;
    state.pausedUntil = now + seconds * 1000;

    return seconds;
}

export function recordServerFailure(
    email: string,
    random: () => number = Math.random,
    now = Date.now()
): number | null {
    const state = stateFor(email);
    state.serverFailures += 1;

    if (state.serverFailures < THROTTLE_FAILURE_LIMIT) return null;
    if (state.pausedUntil > now) return Math.ceil((state.pausedUntil - now) / 1000);

    const level = state.serverFailures - THROTTLE_FAILURE_LIMIT + 1;
    const seconds = backoffSeconds(level, random);
    state.pausedAt = now;
    state.pausedUntil = now + seconds * 1000;

    return seconds;
}

export function recordSuccess(email: string, startedAt = Date.now()): void {
    const state = states.get(email);
    if (!state) return;
    if (state.pausedAt > 0 && startedAt < state.pausedAt) return;

    states.delete(email);
}

export function recordServerSuccess(email: string): void {
    const state = states.get(email);
    if (state) state.serverFailures = 0;
}

export function clearThrottleState(): void {
    states.clear();
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

    return Math.max(1, Math.ceil((date - now) / 1000));
}

function validSeconds(seconds: number | undefined): number | null {
    if (seconds === undefined || !Number.isFinite(seconds)) return null;

    return Math.min(Math.max(Math.ceil(seconds), 1), THROTTLE_MAX_SECONDS);
}

function backoffSeconds(failures: number, random: () => number): number {
    const base = Math.min(
        THROTTLE_BASE_SECONDS * 2 ** (Math.max(1, failures) - 1),
        THROTTLE_MAX_SECONDS
    );
    const jitter = 1 + (random() * 2 - 1) * THROTTLE_JITTER_RATIO;

    return Math.min(Math.max(Math.round(base * jitter), 1), THROTTLE_MAX_SECONDS);
}

function stateFor(email: string): ThrottleState {
    const existing = states.get(email);
    if (existing) return existing;

    const state: ThrottleState = { failures: 0, serverFailures: 0, pausedUntil: 0, pausedAt: 0 };
    states.set(email, state);

    return state;
}
