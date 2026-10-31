import type { RemoteBmp } from '../../../models';
import type { LibraryCandidate } from './metadata';

const PROBE_CACHE_LIMIT = 100_000;
const PROBE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type CachedProbe = { item: RemoteBmp | null; at: number };

const PROBE_CACHE = new Map<string, CachedProbe>();

function probeKey(email: string, candidate: LibraryCandidate): string {
    return [email, candidate.mediaKey, candidate.sha1, candidate.size].join('\u0000');
}

export function readProbe(
    email: string,
    candidate: LibraryCandidate,
    now = Date.now()
): RemoteBmp | null | undefined {
    const key = probeKey(email, candidate);
    const cached = PROBE_CACHE.get(key);
    if (!cached) return undefined;

    PROBE_CACHE.delete(key);
    if (now - cached.at > PROBE_CACHE_TTL_MS) return undefined;

    PROBE_CACHE.set(key, cached);

    return cached.item;
}

export function writeProbe(
    email: string,
    candidate: LibraryCandidate,
    item: RemoteBmp | null,
    now = Date.now()
): void {
    const key = probeKey(email, candidate);

    PROBE_CACHE.delete(key);
    PROBE_CACHE.set(key, { item, at: now });

    while (PROBE_CACHE.size > PROBE_CACHE_LIMIT) {
        const oldest = PROBE_CACHE.keys().next().value;
        if (oldest === undefined) break;

        PROBE_CACHE.delete(oldest);
    }
}

export function clearProbeCache(): void {
    PROBE_CACHE.clear();
}
