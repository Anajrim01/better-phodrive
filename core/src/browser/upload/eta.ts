export const RATE_SAMPLE_WINDOW_MS = 30_000;
export const MIN_RATE_SAMPLE_MS = 500;
/** A rate from a shorter span is a burst, not an estimate. */
export const MIN_ETA_SAMPLE_MS = 3_000;

export type RateSample = { at: number; bytes: number };

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

/** The whole job averages out chunk bursts and the read/compression phase. */
export function averageRate(samples: readonly RateSample[]): number | null {
    if (samples.length < 2) return null;

    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const elapsed = newest.at - oldest.at;
    const bytes = newest.bytes - oldest.bytes;
    if (elapsed < MIN_RATE_SAMPLE_MS || bytes <= 0) return null;

    return (bytes / elapsed) * 1_000;
}

/** Trust the slower of the recent window and the whole job until the current tail proves faster. */
export function estimatedRate(
    samples: readonly RateSample[],
    windowMs = RATE_SAMPLE_WINDOW_MS
): number | null {
    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    if (!oldest || !newest || newest.at - oldest.at < MIN_ETA_SAMPLE_MS) return null;

    const recent = transferRate(samples, windowMs);
    const average = averageRate(samples);
    if (recent === null || average === null) return null;

    return Math.min(recent, average);
}

export function estimatedRemainingSeconds(
    samples: readonly RateSample[],
    remainingBytes: number,
    windowMs = RATE_SAMPLE_WINDOW_MS
): number | null {
    const rate = estimatedRate(samples, windowMs);
    if (rate === null) return null;

    return remainingSeconds(remainingBytes, rate);
}

export function remainingSeconds(remainingBytes: number, bytesPerSecond: number): number | null {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
    if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return null;

    return remainingBytes / bytesPerSecond;
}

/** Keep the first sample for the whole-job rate and enough recent ones for the window. */
export function trimRateSamples(samples: RateSample[], windowMs = RATE_SAMPLE_WINDOW_MS): void {
    const newest = samples[samples.length - 1];
    if (!newest || samples.length < 3) return;

    const cutoff = newest.at - windowMs;
    let firstRecent = 1;
    while (firstRecent < samples.length - 1 && samples[firstRecent].at < cutoff) firstRecent++;
    if (firstRecent > 1) samples.splice(1, firstRecent - 1);
}

export function throttleMessage(
    seconds: number,
    action: 'retrying' | 'try again' = 'retrying'
): string {
    return `Google Photos is limiting requests, ${action} in about ${formatDuration(Math.max(1, Math.round(seconds)))}`;
}

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
