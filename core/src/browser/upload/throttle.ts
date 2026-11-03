export const THROTTLE_MAX_WAIT_SECONDS = 1_800;
export const THROTTLE_RESUME_JITTER_MS = 5_000;

type State = { until: number };

export type ThrottleCoordinator = {
    /** Extend one account's cooldown and return the remaining whole seconds. */
    pause: (email: string, seconds: number) => number;
    /** Wait for the account cooldown, with a small per-waiter resume jitter. */
    wait: (email: string, signal?: AbortSignal) => Promise<void>;
    /** Remaining cooldown in whole seconds, or zero when the account is clear. */
    remaining: (email: string) => number;
    clear: (email?: string) => void;
};

function abortError(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException('Upload cancelled', 'AbortError');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));

            return;
        }

        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        const abort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reject(abortError(signal!));
        };
        signal?.addEventListener('abort', abort, { once: true });
    });
}

/** One cooldown per account, shared by every chunk and file using this coordinator. */
export function createThrottleCoordinator(): ThrottleCoordinator {
    const states = new Map<string, State>();

    const remaining = (email: string): number => {
        const state = states.get(email.toLowerCase());
        if (!state) return 0;

        const milliseconds = state.until - Date.now();
        if (milliseconds <= 0) {
            states.delete(email.toLowerCase());

            return 0;
        }

        return Math.max(1, Math.ceil(milliseconds / 1_000));
    };

    return {
        pause(email, seconds) {
            const key = email.toLowerCase();
            const wait = Math.min(Math.max(Math.ceil(seconds), 1), THROTTLE_MAX_WAIT_SECONDS);
            const until = Date.now() + wait * 1_000;
            const current = states.get(key);
            if (!current || current.until < until) states.set(key, { until });

            return Math.max(1, Math.ceil((states.get(key)!.until - Date.now()) / 1_000));
        },

        async wait(email, signal) {
            const key = email.toLowerCase();

            while (true) {
                const state = states.get(key);
                if (!state) return;

                const milliseconds = state.until - Date.now();
                if (milliseconds <= 0) {
                    states.delete(key);

                    return;
                }

                if (signal?.aborted) throw abortError(signal);

                await delay(
                    milliseconds + Math.floor(Math.random() * THROTTLE_RESUME_JITTER_MS),
                    signal
                );
            }
        },

        remaining,

        clear(email) {
            if (email === undefined) states.clear();
            else states.delete(email.toLowerCase());
        }
    };
}
