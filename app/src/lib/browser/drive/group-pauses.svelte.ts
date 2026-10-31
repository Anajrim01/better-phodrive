import type { GroupAccountState } from '@madkarmaa/phodrive-core/groups';

export type GroupMemberStatus = 'unknown' | 'ready' | 'paused';

const DEFAULT_PAUSE_SECONDS = 60;

export class GroupPauses {
    pausedUntil = $state<Map<string, number>>(new Map());
    observed = $state<Set<string>>(new Set());
    now = $state(Date.now());
    private timer: ReturnType<typeof setInterval> | null = null;

    until(email: string): number {
        return this.pausedUntil.get(email.toLowerCase()) ?? 0;
    }

    status(email: string, now = this.now): GroupMemberStatus {
        const key = email.toLowerCase();
        if ((this.pausedUntil.get(key) ?? 0) > now) return 'paused';

        return this.observed.has(key) ? 'ready' : 'unknown';
    }

    isPaused(email: string): boolean {
        return this.status(email) === 'paused';
    }

    observe(email: string): void {
        const key = email.toLowerCase();
        this.now = Date.now();
        if (this.observed.has(key)) return;

        this.observed = new Set(this.observed).add(key);
    }

    mark(email: string, until: number): void {
        const key = email.toLowerCase();
        const deadline = Math.max(this.pausedUntil.get(key) ?? 0, until);

        this.pausedUntil = new Map(this.pausedUntil).set(key, deadline);
        const observed = new Set(this.observed);
        observed.delete(key);
        this.observed = observed;
        this.now = Date.now();
        this.startTimer();
    }

    apply(accounts: readonly GroupAccountState[]): void {
        const now = Date.now();
        const paused = new Map(this.pausedUntil);
        const observed = new Set(this.observed);

        for (const account of accounts) {
            const key = account.email.toLowerCase();
            if (account.status === 'paused') {
                const seconds = Math.max(
                    1,
                    Math.floor(account.retryAfterSeconds ?? DEFAULT_PAUSE_SECONDS)
                );
                paused.set(key, Math.max(paused.get(key) ?? 0, now + seconds * 1_000));
                observed.delete(key);
            } else if (account.status === 'ok') {
                if ((paused.get(key) ?? 0) <= now) paused.delete(key);
                observed.add(key);
            }
        }

        this.pausedUntil = paused;
        this.observed = observed;
        this.now = now;
        this.startTimer();
    }

    clear(): void {
        this.pausedUntil = new Map();
        this.stopTimer();
    }

    forget(email: string): void {
        const key = email.toLowerCase();
        if (!this.pausedUntil.has(key) && !this.observed.has(key)) return;

        const paused = new Map(this.pausedUntil);
        paused.delete(key);
        this.pausedUntil = paused;

        const observed = new Set(this.observed);
        observed.delete(key);
        this.observed = observed;
    }

    private startTimer(): void {
        if (this.timer || this.pausedUntil.size === 0) return;

        this.timer = setInterval(() => {
            this.now = Date.now();
            this.prune();
            if (this.pausedUntil.size === 0) this.stopTimer();
        }, 1_000);
        const timer = this.timer as unknown as { unref?: () => void };
        timer.unref?.();
    }

    private stopTimer(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private prune(): void {
        const now = Date.now();
        const paused = new Map(this.pausedUntil);
        for (const [email, until] of paused) if (until <= now) paused.delete(email);
        if (paused.size !== this.pausedUntil.size) this.pausedUntil = paused;
    }
}
