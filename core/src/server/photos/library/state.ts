import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RemoteBmp } from '../../../models';
import { isRemoteBmp } from './validation';

const LIBRARY_STATE_VERSION = 1;
const LIBRARY_STATE_FLUSH_DELAY_MS = 1_000;
const LIBRARY_STATE_FLUSH_INTERVAL_MS = 30_000;

export type LibraryAccountState = {
    syncToken: Buffer;
    items: Map<string, RemoteBmp>;
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

            const { syncToken, items } = value as { syncToken?: unknown; items?: unknown };
            if (typeof syncToken !== 'string' || !syncToken || !Array.isArray(items)) continue;

            const saved = new Map<string, RemoteBmp>();
            for (const item of items) {
                if (isRemoteBmp(item)) saved.set(item.mediaKey, item);
            }

            accounts.set(email.toLowerCase(), {
                syncToken: Buffer.from(syncToken, 'base64url'),
                items: saved
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
                    items: [...account.items.values()]
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

export function writeAccountState(
    email: string,
    syncToken: Buffer,
    items: Iterable<RemoteBmp>
): void {
    load();

    accounts.set(email.toLowerCase(), {
        syncToken,
        items: new Map([...items].map((item) => [item.mediaKey, item]))
    });
    dirty = true;
    scheduleFlush();
}

export function updateAccountSyncToken(email: string, syncToken: Buffer): void {
    load();

    const account = accounts.get(email.toLowerCase());
    if (account) account.syncToken = syncToken;
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
