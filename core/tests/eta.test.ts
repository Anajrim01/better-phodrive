import { expect, test } from 'vitest';
import {
    formatDuration,
    MIN_RATE_SAMPLE_MS,
    RATE_SAMPLE_WINDOW_MS,
    remainingSeconds,
    transferRate
} from '@madkarmaa/phodrive-core/browser/upload/eta';

test('transfer rate stays null until two advancing samples span the minimum interval', () => {
    expect(RATE_SAMPLE_WINDOW_MS).toBe(8_000);
    expect(MIN_RATE_SAMPLE_MS).toBe(500);
    expect(transferRate([])).toBeNull();
    expect(transferRate([{ at: 0, bytes: 0 }])).toBeNull();
    expect(
        transferRate([
            { at: 0, bytes: 0 },
            { at: 499, bytes: 499 }
        ])
    ).toBeNull();
    expect(
        transferRate([
            { at: 0, bytes: 500 },
            { at: 1_000, bytes: 500 }
        ])
    ).toBeNull();
    expect(
        transferRate([
            { at: 0, bytes: 1_000 },
            { at: 1_000, bytes: 500 }
        ])
    ).toBeNull();
});

test('transfer rate reports steady bytes per second', () => {
    expect(
        transferRate([
            { at: 0, bytes: 0 },
            { at: 1_000, bytes: 500 },
            { at: 2_500, bytes: 1_250 }
        ])
    ).toBe(500);
});

test('transfer rate ignores samples older than the sample window', () => {
    // The rate over the window is 700000 bytes in 7 s; the full history would add a slower 2 s.
    const samples = [
        { at: 0, bytes: 0 },
        { at: 2_000, bytes: 1_000 },
        { at: 9_000, bytes: 701_000 }
    ];

    expect(transferRate(samples)).toBe(100_000);
    expect(transferRate(samples, 10_000)).toBeCloseTo((701_000 - 0) / 9);
});

test('remaining seconds divides the bytes left by a usable rate', () => {
    expect(remainingSeconds(1_000, 100)).toBe(10);
    expect(remainingSeconds(500, 250)).toBe(2);

    for (const rate of [0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])
        expect(remainingSeconds(1_000, rate)).toBeNull();

    for (const remaining of [0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])
        expect(remainingSeconds(remaining, 100)).toBeNull();
});

test('durations use compact seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(8)).toBe('8 s');
    expect(formatDuration(59)).toBe('59 s');
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(80)).toBe('1 min 20 s');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(3_900)).toBe('1 h 5 min');
});
