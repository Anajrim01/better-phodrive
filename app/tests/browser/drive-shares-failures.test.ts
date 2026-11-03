import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { ShareFailure } from '@madkarmaa/phodrive-core/browser/shares';
import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';
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
        copy: vi.fn(() => ok('copied' as const)),
        checkViewer: vi.fn(() => ok(true)),
        ...overrides
    };
}

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('a generic create failure keeps the dialog open with the server message', async () => {
    const shares = new DriveShares(
        deps({
            create: vi.fn(() => err(failure('REQUEST_FAILED', 'Could not update the share.')))
        })
    );
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');

    expect(shares.createOpen).toBe(true);
    expect(shares.created).toBeNull();
    expect(shares.createErrorCode).toBe('REQUEST_FAILED');
    expect(shares.createError).toBe('Could not update the share.');
});

test('SHARE_LINK_NOT_LIVE keeps the selection so the owner can try again', async () => {
    const shares = new DriveShares(
        deps({
            create: vi.fn(() =>
                err(
                    failure(
                        'SHARE_LINK_NOT_LIVE',
                        'The share link is not serving yet. Check again before retrying.'
                    )
                )
            )
        })
    );
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');

    expect(shares.createErrorCode).toBe('SHARE_LINK_NOT_LIVE');
    expect(shares.createFiles).toHaveLength(1);
    expect(shares.created).toBeNull();
});

test('SHARE_LINK_UNCERTAIN keeps recovery keys and explains the live link risk', async () => {
    const recovery = { envelopeKey: RECORD.envelopeKey, albumKey: RECORD.albumKey };
    const shares = new DriveShares(
        deps({
            create: vi.fn(() =>
                err(
                    failure(
                        'SHARE_LINK_UNCERTAIN',
                        'The share link may still be public. Remove this share album manually.',
                        recovery
                    )
                )
            )
        })
    );
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');

    expect(shares.createErrorCode).toBe('SHARE_LINK_UNCERTAIN');
    expect(shares.createRecovery).toEqual(recovery);
    expect(shares.createError).toContain('may still be public');
});

test('a second create does not run while SHARE_LINK_UNCERTAIN needs review', async () => {
    const recovery = { envelopeKey: RECORD.envelopeKey, albumKey: RECORD.albumKey };
    const create = vi.fn(() =>
        err(failure('SHARE_LINK_UNCERTAIN', 'The share link may still be public.', recovery))
    );
    const shares = new DriveShares(deps({ create }));
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');
    await shares.create('notes');

    expect(create).toHaveBeenCalledTimes(1);
    expect(shares.createRecovery).toEqual(recovery);
});

test('a later share failure does not discard earlier recovery keys', async () => {
    const recovery = { envelopeKey: RECORD.envelopeKey, albumKey: RECORD.albumKey };
    let attempt = 0;
    const shares = new DriveShares(
        deps({
            create: vi.fn(() => {
                attempt++;

                return attempt === 1
                    ? err(
                          failure(
                              'SHARE_LINK_NOT_LIVE',
                              'The share link is not serving yet. Check again before retrying.',
                              recovery
                          )
                      )
                    : err(
                          failure(
                              'SHARE_LINK_NOT_LIVE',
                              'The share link is still not serving. Try again later.'
                          )
                      );
            })
        })
    );
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');
    await shares.create('notes');

    expect(shares.createErrorCode).toBe('SHARE_LINK_NOT_LIVE');
    expect(shares.createRecovery).toEqual(recovery);
});

test('SHARE_URL_TOO_LONG surfaces the size limit without dropping the files', async () => {
    const shares = new DriveShares(
        deps({
            create: vi.fn(() =>
                err(failure('SHARE_URL_TOO_LONG', 'This selection is too large for one share link'))
            )
        })
    );
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('notes');

    expect(shares.createErrorCode).toBe('SHARE_URL_TOO_LONG');
    expect(shares.createFiles).toHaveLength(1);
    expect(shares.createError).toBe('This selection is too large for one share link');
});
