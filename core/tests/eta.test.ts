import { expect, test } from 'vitest';
import {
    averageRate,
    estimatedRate,
    estimatedRemainingSeconds,
    formatDuration,
    MIN_ETA_SAMPLE_MS,
    MIN_RATE_SAMPLE_MS,
    RATE_SAMPLE_WINDOW_MS,
    remainingSeconds,
    transferRate,
    trimRateSamples
} from '@madkarmaa/phodrive-core/browser/upload/eta';

test('transfer rate stays null until two advancing samples span the minimum interval', () => {
    expect(RATE_SAMPLE_WINDOW_MS).toBe(30_000);
    expect(MIN_RATE_SAMPLE_MS).toBe(500);
    expect(MIN_ETA_SAMPLE_MS).toBe(3_000);
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
    const samples = [
        { at: 0, bytes: 0 },
        { at: 2_000, bytes: 1_000 },
        { at: 31_000, bytes: 701_000 }
    ];

    expect(transferRate(samples)).toBeCloseTo((701_000 - 1_000) / 29);
    expect(transferRate(samples, 10_000)).toBeNull();
    expect(transferRate(samples, 40_000)).toBeCloseTo((701_000 - 0) / 31);
});

test('a short or flat tail is not shown as a confident estimate', () => {
    const short = [
        { at: 0, bytes: 0 },
        { at: 2_000, bytes: 20_000 }
    ];
    const stalled = [
        { at: 0, bytes: 0 },
        { at: 5_000, bytes: 50_000 },
        { at: 40_000, bytes: 50_000 }
    ];

    expect(estimatedRate(short)).toBeNull();
    expect(estimatedRemainingSeconds(short, 100_000)).toBeNull();
    expect(estimatedRate(stalled)).toBeNull();
});

test('a compression burst cannot collapse the estimate while raw bytes remain', () => {
    const samples = [
        { at: 0, bytes: 0 },
        { at: 5_000, bytes: 40_000 },
        { at: 10_000, bytes: 80_000 },
        { at: 10_200, bytes: 1_080_000 }
    ];
    const rate = estimatedRate(samples);
    const eta = estimatedRemainingSeconds(samples, 10_000_000);

    expect(rate).not.toBeNull();
    expect(rate!).toBeLessThan(150_000);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(60);
});

test('multiple chunks with a gap and a slow final tail keep a conservative estimate', () => {
    const samples = [
        { at: 0, bytes: 0 },
        { at: 10_000, bytes: 100_000_000 },
        { at: 20_000, bytes: 100_000_000 },
        { at: 21_000, bytes: 200_000_000 },
        { at: 31_000, bytes: 205_000_000 }
    ];
    const rate = estimatedRate(samples)!;
    const eta = estimatedRemainingSeconds(samples, 95_000_000)!;

    expect(rate).toBeLessThan(averageRate(samples)!);
    expect(eta).toBeGreaterThan(18);
    expect(eta).toBeLessThan(40);
});

test('remaining seconds divides the bytes left by a usable rate', () => {
    expect(remainingSeconds(1_000, 100)).toBe(10);
    expect(remainingSeconds(500, 250)).toBe(2);

    for (const rate of [0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])
        expect(remainingSeconds(1_000, rate)).toBeNull();

    for (const remaining of [0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])
        expect(remainingSeconds(remaining, 100)).toBeNull();
});

test('rate history keeps the first sample and the recent window', () => {
    const samples = [
        { at: 0, bytes: 0 },
        { at: 10_000, bytes: 100 },
        { at: 20_000, bytes: 200 },
        { at: 40_000, bytes: 400 },
        { at: 50_000, bytes: 500 }
    ];

    trimRateSamples(samples, 15_000);

    expect(samples.map((sample) => sample.at)).toEqual([0, 40_000, 50_000]);
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
