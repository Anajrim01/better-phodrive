import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/browser/upload';

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('a long cooldown is kept in full instead of being capped at five minutes', () => {
    const throttle = createThrottleCoordinator();

    expect(throttle.pause('first@example.com', 1_800)).toBe(1_800);
    expect(throttle.remaining('first@example.com')).toBe(1_800);

    vi.advanceTimersByTime(1_800_000);
    expect(throttle.remaining('first@example.com')).toBe(0);
});

test('an extended cooldown moves the shared deadline forward', async () => {
    const throttle = createThrottleCoordinator();
    throttle.pause('first@example.com', 60);
    vi.advanceTimersByTime(30_000);

    expect(throttle.pause('first@example.com', 120)).toBe(120);

    let finished = false;
    const waiting = throttle.wait('first@example.com').then(() => {
        finished = true;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await waiting;
    expect(finished).toBe(true);
});

test('waiters resume at different times after the same cooldown', async () => {
    const throttle = createThrottleCoordinator();
    throttle.pause('first@example.com', 60);
    vi.mocked(Math.random).mockReturnValueOnce(0).mockReturnValueOnce(0.5);

    let first = false;
    let second = false;
    const one = throttle.wait('first@example.com').then(() => {
        first = true;
    });
    const two = throttle.wait('first@example.com').then(() => {
        second = true;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(first).toBe(true);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(2_500);
    await Promise.all([one, two]);
    expect(first).toBe(true);
    expect(second).toBe(true);
});

test('cancelling a wait stops the waiter', async () => {
    const throttle = createThrottleCoordinator();
    const controller = new AbortController();
    throttle.pause('first@example.com', 60);

    const waiting = throttle.wait('first@example.com', controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
});

test('another account does not inherit a cooldown', async () => {
    const throttle = createThrottleCoordinator();
    throttle.pause('first@example.com', 1_800);

    await expect(throttle.wait('second@example.com')).resolves.toBeUndefined();
    expect(throttle.remaining('second@example.com')).toBe(0);
});
