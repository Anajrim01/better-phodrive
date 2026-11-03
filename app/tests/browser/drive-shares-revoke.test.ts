import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ShareFailure } from '@madkarmaa/phodrive-core/browser/shares';
import type {
    ShareRecord,
    ShareRevokeRequest,
    ShareRevokeResponse
} from '@madkarmaa/phodrive-core/share-models';
import { DriveShares, type ShareDeps } from '#browser/drive/shares.svelte';
import { ShareStore } from '#browser/shares';
import { file } from '../components/file-fixtures';

const { storage } = vi.hoisted(() => {
    class MemoryStorage implements Storage {
        private readonly items = new Map<string, string>();

        get length(): number {
            return this.items.size;
        }

        key(index: number): string | null {
            return [...this.items.keys()][index] ?? null;
        }

        getItem(key: string): string | null {
            return this.items.get(key) ?? null;
        }

        setItem(key: string, value: string): void {
            this.items.set(key, value);
        }

        removeItem(key: string): void {
            this.items.delete(key);
        }

        clear(): void {
            this.items.clear();
        }
    }

    const storage = new MemoryStorage();
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

const EMAIL = 'owner@example.com';
const TOKEN = 'aas_et/test';
const RECORD: ShareRecord = {
    name: 'notes',
    envelopeKey: 'AF1QipEnvelope',
    albumKey: 'AF1QipAlbum',
    shortUrl: 'https://photos.app.goo.gl/abc123',
    albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
    authKey: 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR',
    shareUrl: 'https://shared.phodrive.dev/#share=eyJ2IjoxfQ',
    createdAt: 1_700_000_000_000
};
const REVOKE_RESPONSE: ShareRevokeResponse = {
    revoked: true,
    shortUrlStatus: 404,
    albumUrlStatus: 404,
    directUrlStatus: 404,
    envelopeDeleted: true,
    albumRemoved: true
};

function ok<T>(value: T): AsyncResult<T, never> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

function err<E>(error: E): AsyncResult<never, E> {
    return Ok(undefined).andThenAsync(async () => Err(error));
}

function failure(code: string, message: string, recovery?: ShareFailure['recovery']): ShareFailure {
    return { code, message, ...(recovery === undefined ? {} : { recovery }) };
}

function deps(overrides: Partial<ShareDeps> = {}): ShareDeps {
    return {
        account: () => ({ email: EMAIL, token: TOKEN }),
        busy: () => false,
        loading: () => false,
        store: new ShareStore(),
        revoke: vi.fn(() => ok(REVOKE_RESPONSE)),
        copy: vi.fn(() => ok('copied' as const)),
        checkViewer: vi.fn(() => ok(true)),
        ...overrides
    };
}

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('revoke removes the record and confirms after the server verifies it', async () => {
    const store = new ShareStore();
    store.save(EMAIL, RECORD);
    const revoke = vi.fn(() => ok(REVOKE_RESPONSE));
    const shares = new DriveShares(deps({ store, revoke }));
    await shares.checkAvailability();

    shares.openRevoke(RECORD);
    await shares.revoke();

    expect(revoke).toHaveBeenCalledWith({
        action: 'revoke',
        email: EMAIL,
        token: TOKEN,
        envelopeKey: RECORD.envelopeKey,
        albumKey: RECORD.albumKey,
        shortUrl: RECORD.shortUrl,
        albumUrl: RECORD.albumUrl
    } satisfies ShareRevokeRequest);
    expect(shares.records).toEqual([]);
    expect(shares.revokeOpen).toBe(false);
    expect(shares.revokeNotice).toBe('Share revoked. The link no longer opens.');
});

test('SHARE_REVOKE_UNVERIFIED keeps the record and recovery guidance', async () => {
    const store = new ShareStore();
    store.save(EMAIL, RECORD);
    const recovery = { envelopeKey: RECORD.envelopeKey, albumKey: RECORD.albumKey };
    const shares = new DriveShares(
        deps({
            store,
            revoke: vi.fn(() =>
                err(
                    failure(
                        'SHARE_REVOKE_UNVERIFIED',
                        'Could not confirm the old share link stopped serving. Retry revoke.',
                        recovery
                    )
                )
            )
        })
    );
    await shares.checkAvailability();

    shares.openRevoke(RECORD);
    await shares.revoke();

    expect(shares.records).toEqual([RECORD]);
    expect(shares.revokeOpen).toBe(true);
    expect(shares.revokeErrorCode).toBe('SHARE_REVOKE_UNVERIFIED');
    expect(shares.revokeRecovery).toEqual(recovery);
    expect(shares.revokeNotice).toBe('');
});

test('SHARE_LINK_STILL_LIVE keeps the link so revoke can be retried', async () => {
    const store = new ShareStore();
    store.save(EMAIL, RECORD);
    const shares = new DriveShares(
        deps({
            store,
            revoke: vi.fn(() =>
                err(
                    failure(
                        'SHARE_LINK_STILL_LIVE',
                        'The old share link is still serving. Retry revoke before sharing again.'
                    )
                )
            )
        })
    );
    await shares.checkAvailability();

    shares.openRevoke(RECORD);
    await shares.revoke();

    expect(shares.records).toEqual([RECORD]);
    expect(shares.revokeErrorCode).toBe('SHARE_LINK_STILL_LIVE');
    expect(shares.revokeNotice).toBe('');
});

test('the list follows the active account and a switch clears transient state', async () => {
    let email = EMAIL;
    const store = new ShareStore();
    store.save(EMAIL, RECORD);
    const shares = new DriveShares(deps({ store, account: () => ({ email, token: TOKEN }) }));
    await shares.checkAvailability();
    shares.open([file()]);
    shares.openRevoke(RECORD);

    email = 'second@example.com';
    shares.reset();

    expect(shares.records).toEqual([]);
    expect(shares.createOpen).toBe(false);
    expect(shares.revokeOpen).toBe(false);
    expect(shares.created).toBeNull();
    expect(shares.copyState).toBe('idle');
});
