import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RemoteBmp } from '../../../models';
import { parseAccountState } from './state-parse';

const LIBRARY_STATE_VERSION = 4;
const LIBRARY_STATE_FLUSH_DELAY_MS = 1_000;
const LIBRARY_STATE_FLUSH_INTERVAL_MS = 30_000;
const LIBRARY_STATE_DAY_MS = 24 * 60 * 60 * 1_000;
export const LIBRARY_STATE_LOG_LIMIT = 64;
export const LIBRARY_STATE_LOG_MAX_AGE_MS = LIBRARY_STATE_DAY_MS;
export const LIBRARY_STATE_LOG_MAX_ITEMS = 10_000;

export type LibraryChange = {
    revision: number;
    at: number;
    items: RemoteBmp[];
    deleted: string[];
};

export type LibraryAccountState = {
    syncToken: Buffer;
    revision: number;
    items: Map<string, RemoteBmp>;
    log: LibraryChange[];
};

const accounts = new Map<string, LibraryAccountState>();
let stateFile: string | null = null;
let loaded = false;
let dirty = false;
let lastFlushAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function configureLibraryState(path: string | null): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    stateFile = path;
    loaded = false;
    dirty = false;
    lastFlushAt = 0;
    accounts.clear();
}

function load(): void {
    if (loaded) return;
    loaded = true;
    if (!stateFile) return;

    try {
        const data: unknown = JSON.parse(readFileSync(stateFile, 'utf8'));
        if (!data || typeof data !== 'object') return;

        const stored = data as { version?: unknown; accounts?: unknown };
        if (
            stored.version !== LIBRARY_STATE_VERSION ||
            !stored.accounts ||
            typeof stored.accounts !== 'object'
        )
            return;

        for (const [email, value] of Object.entries(stored.accounts)) {
            const account = parseAccountState(value);
            if (account) accounts.set(email.toLowerCase(), account);
        }
    } catch {
        // A corrupt state file falls back to a full sync.
    }
}

export function flushLibraryState(): void {
    if (!stateFile || !dirty) return;

    try {
        const stored = Object.fromEntries(
            [...accounts].map(([email, account]) => [
                email,
                {
                    syncToken: account.syncToken.toString('base64url'),
                    revision: account.revision,
                    items: [...account.items.values()],
                    log: account.log
                }
            ])
        );
        const temp = `${stateFile}.tmp`;

        mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
        writeFileSync(temp, JSON.stringify({ version: LIBRARY_STATE_VERSION, accounts: stored }), {
            mode: 0o600
        });
        renameSync(temp, stateFile);
        dirty = false;
        lastFlushAt = Date.now();
    } catch {
        lastFlushAt = Date.now();
        scheduleFlush();
    }
}

function scheduleFlush(): void {
    if (!stateFile || flushTimer || !dirty) return;

    const wait = Math.max(
        LIBRARY_STATE_FLUSH_DELAY_MS,
        lastFlushAt + LIBRARY_STATE_FLUSH_INTERVAL_MS - Date.now()
    );
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushLibraryState();
    }, wait);
    flushTimer.unref();
}

export function readAccountState(email: string): LibraryAccountState | undefined {
    load();

    return accounts.get(email.toLowerCase());
}

export function readAccountRevision(email: string): number {
    return readAccountState(email)?.revision ?? 0;
}

export function writeAccountState(email: string, state: LibraryAccountState): void {
    load();

    accounts.set(email.toLowerCase(), state);
    dirty = true;
    scheduleFlush();
}

export function updateAccountSyncToken(email: string, syncToken: Buffer): void {
    load();

    const account = accounts.get(email.toLowerCase());
    if (!account) return;

    account.syncToken = syncToken;
    dirty = true;
    scheduleFlush();
}

export function trimChangeLog(log: readonly LibraryChange[], now = Date.now()): LibraryChange[] {
    const recent = log
        .filter((entry) => now - entry.at <= LIBRARY_STATE_LOG_MAX_AGE_MS)
        .slice(-LIBRARY_STATE_LOG_LIMIT);
    const kept: LibraryChange[] = [];
    let items = 0;

    for (let index = recent.length - 1; index >= 0; index--) {
        const entry = recent[index];
        const size = entry.items.length + entry.deleted.length;
        if (items + size > LIBRARY_STATE_LOG_MAX_ITEMS) break;

        kept.unshift(entry);
        items += size;
    }

    return kept;
}

function recordChange(
    state: LibraryAccountState,
    items: RemoteBmp[],
    deleted: string[],
    now: number
): void {
    if (items.length === 0 && deleted.length === 0) return;

    const revision = state.revision + 1;
    state.revision = revision;
    state.log = trimChangeLog([...state.log, { revision, at: now, items, deleted }]);
    dirty = true;
    scheduleFlush();
}

/** Mark chunks as trashed so the app moves the file without waiting for a delta. */
export function markChunksTrashed(
    email: string,
    chunks: readonly { mediaKey: string }[],
    now = Date.now()
): void {
    load();

    const state = accounts.get(email.toLowerCase());
    if (!state) return;

    const changed: RemoteBmp[] = [];
    for (const chunk of chunks) {
        const item = state.items.get(chunk.mediaKey);
        if (!item || item.trashedAt !== undefined) continue;

        const trashed = { ...item, trashedAt: now };
        state.items.set(chunk.mediaKey, trashed);
        changed.push(trashed);
    }

    recordChange(state, changed, [], now);
}

/** Clear the trashed mark after a successful restore from Google Photos trash. */
export function markChunksRestored(
    email: string,
    chunks: readonly { mediaKey: string }[],
    now = Date.now()
): void {
    load();

    const state = accounts.get(email.toLowerCase());
    if (!state) return;

    const changed: RemoteBmp[] = [];
    for (const chunk of chunks) {
        const item = state.items.get(chunk.mediaKey);
        if (!item || item.trashedAt === undefined) continue;

        const { trashedAt, ...restored } = item;
        state.items.set(chunk.mediaKey, restored);
        changed.push(restored);
    }

    recordChange(state, changed, [], now);
}

/** Remove chunks after Google Photos permanently deletes them. */
export function removeChunks(
    email: string,
    chunks: readonly { mediaKey: string }[],
    now = Date.now()
): void {
    load();

    const state = accounts.get(email.toLowerCase());
    if (!state) return;

    const removed: string[] = [];
    for (const chunk of chunks) {
        if (state.items.delete(chunk.mediaKey)) removed.push(chunk.mediaKey);
    }

    recordChange(state, [], removed, now);
}

export function deleteAccountState(email: string): void {
    load();

    if (!accounts.delete(email.toLowerCase())) return;

    dirty = true;
    scheduleFlush();
}

export function clearLibraryState(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    accounts.clear();
    loaded = false;
    dirty = false;
    lastFlushAt = 0;
}
