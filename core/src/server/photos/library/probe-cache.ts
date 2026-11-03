import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { RemoteBmpSchema, type RemoteBmp } from '../../../models';
import type { LibraryCandidate } from './metadata';

const PROBE_CACHE_LIMIT = 100_000;
const PROBE_CACHE_NEGATIVE_TTL_MS = 60 * 60 * 1_000;
const PROBE_CACHE_FLUSH_DELAY_MS = 1_000;
const PROBE_CACHE_FLUSH_INTERVAL_MS = 30_000;

type CachedProbe = { item: RemoteBmp | null; at: number };

const CachedProbeSchema = z.object({
    key: z.string().min(1),
    at: z.number(),
    item: RemoteBmpSchema.nullable()
});
export const ProbeContentSchema = RemoteBmpSchema.omit({
    mediaKey: true,
    at: true,
    sha1: true,
    chunkCount: true
});
export type ProbeContent = z.infer<typeof ProbeContentSchema>;
const CachedContentSchema = z.object({
    key: z.string().min(1),
    content: ProbeContentSchema
});
const ProbeCacheSchema = z.object({
    entries: z.array(CachedProbeSchema),
    content: z.array(CachedContentSchema).optional()
});

const PROBE_CACHE = new Map<string, CachedProbe>();
const CONTENT_CACHE = new Map<string, ProbeContent>();
let cacheFile: string | null = null;
let loaded = false;
let dirty = false;
let lastFlushAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function configureProbeCache(path: string | null): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    cacheFile = path;
    loaded = false;
    dirty = false;
    lastFlushAt = 0;
    CONTENT_CACHE.clear();
}

function probeKey(email: string, candidate: LibraryCandidate): string {
    return [email, candidate.mediaKey, candidate.sha1, candidate.size].join('\u0000');
}

function load(): void {
    if (loaded) return;
    loaded = true;
    if (!cacheFile) return;

    try {
        const data: unknown = JSON.parse(readFileSync(cacheFile, 'utf8'));
        const parsed = ProbeCacheSchema.safeParse(data);
        if (!parsed.success) return;

        for (const entry of parsed.data.entries) {
            PROBE_CACHE.set(entry.key, { item: entry.item, at: entry.at });
        }
        for (const entry of parsed.data.content ?? []) {
            CONTENT_CACHE.set(entry.key, entry.content);
        }

        while (PROBE_CACHE.size > PROBE_CACHE_LIMIT) {
            const oldest = PROBE_CACHE.keys().next().value;
            if (oldest === undefined) break;

            PROBE_CACHE.delete(oldest);
        }
    } catch {
        // A corrupt cache must not block a fresh probe pass.
    }
}

export function flushProbeCache(): void {
    if (!cacheFile || !dirty) return;

    try {
        const entries = [...PROBE_CACHE]
            .slice(-PROBE_CACHE_LIMIT)
            .map(([key, value]) => ({ key, at: value.at, item: value.item }));
        const content = [...CONTENT_CACHE]
            .slice(-PROBE_CACHE_LIMIT)
            .map(([key, value]) => ({ key, content: value }));
        const temp = `${cacheFile}.tmp`;

        mkdirSync(dirname(cacheFile), { recursive: true, mode: 0o700 });
        writeFileSync(temp, JSON.stringify(content.length ? { entries, content } : { entries }), {
            mode: 0o600
        });
        renameSync(temp, cacheFile);
        dirty = false;
        lastFlushAt = Date.now();
    } catch {
        lastFlushAt = Date.now();
        scheduleFlush();
    }
}

function scheduleFlush(): void {
    if (!cacheFile || flushTimer || !dirty) return;

    const wait = Math.max(
        PROBE_CACHE_FLUSH_DELAY_MS,
        lastFlushAt + PROBE_CACHE_FLUSH_INTERVAL_MS - Date.now()
    );
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushProbeCache();
    }, wait);
    flushTimer.unref();
}

export function readProbe(
    email: string,
    candidate: LibraryCandidate,
    now = Date.now()
): RemoteBmp | null | undefined {
    load();

    const key = probeKey(email, candidate);
    const cached = PROBE_CACHE.get(key);
    if (!cached) return undefined;

    PROBE_CACHE.delete(key);
    if (cached.item === null && now - cached.at > PROBE_CACHE_NEGATIVE_TTL_MS) return undefined;

    PROBE_CACHE.set(key, cached);

    return cached.item;
}

export function writeProbe(
    email: string,
    candidate: LibraryCandidate,
    item: RemoteBmp | null,
    now = Date.now()
): void {
    load();

    const key = probeKey(email, candidate);

    PROBE_CACHE.delete(key);
    PROBE_CACHE.set(key, { item, at: now });
    dirty = true;
    scheduleFlush();

    while (PROBE_CACHE.size > PROBE_CACHE_LIMIT) {
        const oldest = PROBE_CACHE.keys().next().value;
        if (oldest === undefined) break;

        PROBE_CACHE.delete(oldest);
    }
}

function contentKey(email: string, candidate: LibraryCandidate): string {
    return [email.toLowerCase(), candidate.sha1, candidate.size].join('|');
}

/** Reuse bytes-derived probe fields across media keys and pages. */
export function readContentProbe(
    email: string,
    candidate: LibraryCandidate
): ProbeContent | undefined {
    load();

    return CONTENT_CACHE.get(contentKey(email, candidate));
}

export function writeContentProbe(
    email: string,
    candidate: LibraryCandidate,
    item: RemoteBmp
): void {
    load();

    const { mediaKey: _mediaKey, at: _at, sha1: _sha1, chunkCount: _chunkCount, ...content } = item;
    const parsed = ProbeContentSchema.safeParse(content);
    if (!parsed.success) return;

    const key = contentKey(email, candidate);
    CONTENT_CACHE.delete(key);
    CONTENT_CACHE.set(key, parsed.data);
    dirty = true;
    scheduleFlush();

    while (CONTENT_CACHE.size > PROBE_CACHE_LIMIT) {
        const oldest = CONTENT_CACHE.keys().next().value;
        if (oldest === undefined) break;

        CONTENT_CACHE.delete(oldest);
    }
}

export function clearProbeCache(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    PROBE_CACHE.clear();
    CONTENT_CACHE.clear();
    loaded = false;
    dirty = false;
    lastFlushAt = 0;
}
