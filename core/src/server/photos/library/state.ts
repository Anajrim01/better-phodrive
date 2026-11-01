import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RemoteBmp } from '../../../models';
import { isRemoteBmp } from './validation';

const LIBRARY_STATE_VERSION = 2;
const LIBRARY_STATE_FLUSH_DELAY_MS = 1_000;
const LIBRARY_STATE_FLUSH_INTERVAL_MS = 30_000;
export const LIBRARY_STATE_LOG_LIMIT = 64;
export const LIBRARY_STATE_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
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
            if (!value || typeof value !== 'object') continue;

            const { syncToken, revision, items, log } = value as {
                syncToken?: unknown;
                revision?: unknown;
                items?: unknown;
                log?: unknown;
            };
            if (
                typeof syncToken !== 'string' ||
                !syncToken ||
                !Array.isArray(items) ||
                typeof revision !== 'number' ||
                !Number.isSafeInteger(revision) ||
                revision < 0
            )
                continue;

            const saved = new Map<string, RemoteBmp>();
            for (const item of items) {
                if (isRemoteBmp(item)) saved.set(item.mediaKey, item);
            }

            const changes: LibraryChange[] = [];
            let lastRevision = 0;
            if (Array.isArray(log)) {
                for (const entry of log) {
                    if (!entry || typeof entry !== 'object') continue;

                    const {
                        revision: entryRevision,
                        at,
                        items: changed,
                        deleted
                    } = entry as {
                        revision?: unknown;
                        at?: unknown;
                        items?: unknown;
                        deleted?: unknown;
                    };
                    if (
                        typeof entryRevision !== 'number' ||
                        !Number.isSafeInteger(entryRevision) ||
                        entryRevision <= lastRevision ||
                        entryRevision > revision ||
                        typeof at !== 'number' ||
                        !Array.isArray(changed) ||
                        !Array.isArray(deleted)
                    )
                        continue;

                    lastRevision = entryRevision;
                    changes.push({
                        revision: entryRevision,
                        at,
                        items: changed.filter(isRemoteBmp),
                        deleted: deleted.filter(
                            (mediaKey): mediaKey is string => typeof mediaKey === 'string'
                        )
                    });
                }
            }

            accounts.set(email.toLowerCase(), {
                syncToken: Buffer.from(syncToken, 'base64url'),
                revision,
                items: saved,
                log: changes
            });
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
    if (account) account.syncToken = syncToken;
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
