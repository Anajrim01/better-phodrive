import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { ApplicationError } from '@madkarmaa/phodrive-core/errors';
import type { ShareFailure } from '@madkarmaa/phodrive-core/browser/shares';
import type {
    ShareCreateRequest,
    ShareCreateResponse,
    ShareRecord
} from '@madkarmaa/phodrive-core/share-models';
import { DriveShares, type ShareDeps } from '#browser/drive/shares.svelte';
import { ShareStore } from '#browser/shares';
import { STORAGE_UNAVAILABLE } from '#browser/persisted';
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
const CREATE_RESPONSE: ShareCreateResponse = {
    record: RECORD,
    manifest: {
        v: 1,
        album: RECORD.albumUrl,
        files: [{ id: 'a'.repeat(64), chunks: 1, name: 'proof.bin' }]
    }
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
        create: vi.fn(() => ok(CREATE_RESPONSE)),
        copy: vi.fn(() => ok('copied' as const)),
        checkViewer: vi.fn(() => ok(true)),
        ...overrides
    };
}

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

test('create stays gated while the viewer is unavailable and produces no link', async () => {
    const create = vi.fn(() => ok(CREATE_RESPONSE));
    const gated = new DriveShares(deps({ checkViewer: vi.fn(() => ok(false)), create }));
    await gated.checkAvailability();

    expect(gated.shareAvailable).toBe(false);
    gated.open([file()]);
    await gated.create('notes');
    expect(gated.createOpen).toBe(false);
    expect(gated.created).toBeNull();
    expect(create).not.toHaveBeenCalled();

    const available = new DriveShares(deps());
    await available.checkAvailability();
    available.open([file()]);

    expect(available.shareAvailable).toBe(true);
    expect(available.createOpen).toBe(true);
    expect(available.createFiles).toEqual([file()]);
    expect(available.createInvalid).toBe('');
});

test('create sends the selected files, saves the record, and keeps the link on screen', async () => {
    const store = new ShareStore();
    const create = vi.fn(() => ok(CREATE_RESPONSE));
    const shares = new DriveShares(deps({ store, create }));
    await shares.checkAvailability();

    shares.open([file()]);
    await shares.create('notes');

    expect(create).toHaveBeenCalledWith({
        action: 'create',
        email: EMAIL,
        token: TOKEN,
        name: 'notes',
        files: [
            {
                id: 'a'.repeat(64),
                name: 'proof.bin',
                chunks: [{ index: 0, mediaKey: 'media-0' }]
            }
        ]
    } satisfies ShareCreateRequest);
    expect(shares.created).toEqual(RECORD);
    expect(shares.records).toEqual([RECORD]);
    expect(shares.storageNotice).toBe('');
});

test('an invalid name is rejected before the request leaves the browser', async () => {
    const create = vi.fn(() => ok(CREATE_RESPONSE));
    const shares = new DriveShares(deps({ create }));
    await shares.checkAvailability();
    shares.open([file()]);

    await shares.create('   ');

    expect(create).not.toHaveBeenCalled();
    expect(shares.createError).toBe('Enter a name for the share link.');
});

test('storage failure keeps the created link visible and explains the missing list entry', async () => {
    class FailingStore extends ShareStore {
        override save(): Result<void, ApplicationError> {
            return Err(STORAGE_UNAVAILABLE);
        }
    }

    const shares = new DriveShares(deps({ store: new FailingStore() }));
    await shares.checkAvailability();
    shares.open([file()]);
    await shares.create('notes');

    expect(shares.created).toEqual(RECORD);
    expect(shares.created?.shareUrl).toBe(RECORD.shareUrl);
    expect(shares.created?.envelopeKey).toBe(RECORD.envelopeKey);
    expect(shares.created?.albumKey).toBe(RECORD.albumKey);
    expect(shares.storageNotice).toBe(
        'This share was created, but it was not saved in this browser.'
    );
});

test('a folder in a share selection disables create instead of dropping the folder', async () => {
    const create = vi.fn(() => ok(CREATE_RESPONSE));
    const shares = new DriveShares(deps({ create }));
    await shares.checkAvailability();
    const folder = { path: 'Reports', name: 'Reports', files: 1, subfolders: 0 };

    shares.open([file(), folder]);

    expect(shares.createOpen).toBe(true);
    expect(shares.createInvalid).toBe('Sharing folders is not available. Select files only.');
    expect(shares.createFiles).toHaveLength(1);

    await shares.create('notes');

    expect(create).not.toHaveBeenCalled();
    expect(shares.created).toBeNull();
});

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
    const recovery = { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' };
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

test('a later share failure does not discard earlier uncertain recovery keys', async () => {
    const recovery = { envelopeKey: 'AF1QipEnvelope', albumKey: 'AF1QipAlbum' };
    let attempt = 0;
    const shares = new DriveShares(
        deps({
            create: vi.fn(() => {
                attempt++;

                return attempt === 1
                    ? err(
                          failure(
                              'SHARE_LINK_UNCERTAIN',
                              'The share link may still be public.',
                              recovery
                          )
                      )
                    : err(
                          failure(
                              'SHARE_LINK_NOT_LIVE',
                              'The share link is not serving yet. Check again before retrying.'
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

test('copy fallback reports that the link must be selected manually', async () => {
    const shares = new DriveShares(deps({ copy: vi.fn(() => ok('manual' as const)) }));
    await shares.checkAvailability();
    shares.open([file()]);
    await shares.create('notes');

    await shares.copy(RECORD);

    expect(shares.copyState).toBe('manual');
    expect(shares.copiedKey).toBe(RECORD.envelopeKey);
});
