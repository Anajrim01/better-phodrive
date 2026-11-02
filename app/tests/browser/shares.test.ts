import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SHARES_KEY, SHARES_SERIALIZER, ShareStore } from '#browser/shares';
import type { ShareRecord } from '@madkarmaa/phodrive-core/share-models';

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

beforeEach(() => storage.clear());
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

const EMAIL = 'owner@example.com';
const RECORD: ShareRecord = {
    name: 'Holiday photos',
    envelopeKey: 'AF1QipEnvelope',
    albumKey: 'AF1QipAlbum',
    shortUrl: 'https://photos.app.goo.gl/abc123',
    albumUrl: 'https://photos.google.com/share/AbCdEf?key=M2ZXZ1',
    authKey: 'M2ZXZ1ZVa3U1anM5QUZITzhySDFSYk1Xb19FelhR',
    shareUrl:
        'https://shared.phodrive.dev/#share=eyJ2IjoxLCJhbGJ1bSI6Imh0dHBzOi8vcGhvdG9zLmdvb2dsZS5jb20vc2hhcmUvQWJDZEVmP2tleT1NMlpYWjEiLCJmaWxlcyI6W3siaWQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsImNodW5rcyI6MX1dfQ',
    createdAt: 1_700_000_000_000
};

test('share records persist per account and replace the same envelope', () => {
    const store = new ShareStore();
    expect(store.save(EMAIL, RECORD).isOk()).toBe(true);
    expect(store.list(EMAIL)).toEqual([RECORD]);
    expect(store.get(EMAIL, RECORD.envelopeKey)).toEqual(RECORD);

    const updated = { ...RECORD, name: 'Updated name', createdAt: RECORD.createdAt + 1 };
    expect(store.save(EMAIL, updated).isOk()).toBe(true);
    expect(store.list(EMAIL)).toEqual([updated]);
    expect(JSON.parse(storage.getItem(SHARES_KEY) ?? '{}')[EMAIL]).toHaveLength(1);
});

test('another account cannot read or remove a share', () => {
    const store = new ShareStore();
    store.save(EMAIL, RECORD);

    expect(store.list('other@example.com')).toEqual([]);
    expect(store.remove('other@example.com', RECORD.envelopeKey).isOk()).toBe(true);
    expect(store.list(EMAIL)).toEqual([RECORD]);
});

test('removing a share keeps the other records', () => {
    const store = new ShareStore();
    const second = { ...RECORD, envelopeKey: 'AF1QipSecond', createdAt: RECORD.createdAt + 2 };
    store.save(EMAIL, RECORD);
    store.save(EMAIL, second);

    expect(store.remove(EMAIL, RECORD.envelopeKey).isOk()).toBe(true);
    expect(store.list(EMAIL)).toEqual([second]);
});

test('invalid stored data is discarded instead of breaking the store', () => {
    storage.setItem(SHARES_KEY, '{"owner@example.com":[{"name":"bad"}]}');
    const store = new ShareStore();

    expect(store.list(EMAIL)).toEqual([]);
    expect(SHARES_SERIALIZER.deserialize('{"owner@example.com":[]}')).toEqual({
        'owner@example.com': []
    });
});

test('an invalid record is rejected before writing', () => {
    const store = new ShareStore();
    const invalid = { ...RECORD, albumUrl: 'https://example.com/share/abc?key=def' };

    expect(store.save(EMAIL, invalid).isErr()).toBe(true);
    expect(storage.getItem(SHARES_KEY) ?? '').not.toContain(EMAIL);
});
