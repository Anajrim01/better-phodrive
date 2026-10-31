export const THROTTLE_BASE_SECONDS = 60;
export const THROTTLE_MAX_SECONDS = 1_800;
export const THROTTLE_JITTER_RATIO = 0.2;
export const THROTTLE_FAILURE_LIMIT = 3;

type ThrottleState = {
    failures: number;
    serverFailures: number;
    pausedUntil: number;
};

const states = new Map<string, ThrottleState>();

export function throttleWaitSeconds(email: string, now: number = Date.now()): number | null {
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
    random: () => number = Math.random
): number {
    const state = stateFor(email);
    state.failures += 1;
    state.serverFailures = 0;

    const headerWait =
        retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
            ? clampSeconds(Math.round(retryAfterSeconds))
            : null;
    const seconds = headerWait ?? backoffSeconds(state.failures, random);

    state.pausedUntil = Date.now() + seconds * 1000;

    return seconds;
}

export function recordServerFailure(
    email: string,
    random: () => number = Math.random
): number | null {
    const state = stateFor(email);
    state.failures += 1;
    state.serverFailures += 1;

    if (state.serverFailures < THROTTLE_FAILURE_LIMIT) return null;

    const seconds = backoffSeconds(state.failures, random);
    state.pausedUntil = Date.now() + seconds * 1000;

    return seconds;
}

export function recordSuccess(email: string): void {
    states.delete(email);
}

export function clearThrottleState(): void {
    states.clear();
}

export function parseRetryAfter(
    value: string | null,
    now: number = Date.now()
): number | undefined {
    if (value === null) return undefined;

    const text = value.trim();
    if (!text) return undefined;

    if (/^-?\d+$/.test(text)) return Math.max(1, Number(text));

    const date = Date.parse(text);
    if (Number.isNaN(date)) return undefined;

    return Math.max(1, Math.round((date - now) / 1000));
}

function backoffSeconds(failures: number, random: () => number): number {
    const base = Math.min(
        THROTTLE_BASE_SECONDS * 2 ** (Math.max(1, failures) - 1),
        THROTTLE_MAX_SECONDS
    );
    const jitter = 1 + (random() * 2 - 1) * THROTTLE_JITTER_RATIO;

    return clampSeconds(Math.round(base * jitter));
}

function clampSeconds(seconds: number): number {
    return Math.min(Math.max(seconds, 1), THROTTLE_MAX_SECONDS);
}

function stateFor(email: string): ThrottleState {
    const existing = states.get(email);
    if (existing) return existing;

    const state: ThrottleState = { failures: 0, serverFailures: 0, pausedUntil: 0 };
    states.set(email, state);

    return state;
}
