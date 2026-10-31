/** Estimates how much longer a transfer needs from recent progress samples. */

export const RATE_SAMPLE_WINDOW_MS = 8_000;
export const MIN_RATE_SAMPLE_MS = 500;

export type RateSample = { at: number; bytes: number };

/** Bytes per second over the newest samples, or null until the rate is meaningful. */
export function transferRate(
    samples: readonly RateSample[],
    windowMs = RATE_SAMPLE_WINDOW_MS
): number | null {
    if (samples.length < 2) return null;

    const newest = samples[samples.length - 1];
    const oldest = samples.find((sample) => newest.at - sample.at <= windowMs) ?? samples[0];
    const elapsed = newest.at - oldest.at;
    const bytes = newest.bytes - oldest.bytes;
    if (elapsed < MIN_RATE_SAMPLE_MS || bytes <= 0) return null;

    return (bytes / elapsed) * 1_000;
}

/** Seconds needed for the remaining bytes, or null when the rate is unusable. */
export function remainingSeconds(remainingBytes: number, bytesPerSecond: number): number | null {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
    if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return null;

    return remainingBytes / bytesPerSecond;
}

/** Compact, rounded duration such as "8 s", "1 min 20 s", or "2 h 5 min". */
export function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    if (total < 60) return `${total} s`;

    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;

    return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
}
