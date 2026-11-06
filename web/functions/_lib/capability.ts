export const CAPABILITY_AAD = new TextEncoder().encode('phodrive-share-capability-v1');

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_URL_LENGTH = 2_048;
const MAX_TOTAL_BYTES = 200_000_000;
const MAX_SHARE_ID_LENGTH = 128;
const MAX_FILE_ID_LENGTH = 128;
export const MEDIA_HOSTS: ReadonlySet<string> = new Set([
    'lh1.googleusercontent.com',
    'lh2.googleusercontent.com',
    'lh3.googleusercontent.com',
    'lh4.googleusercontent.com',
    'lh5.googleusercontent.com'
]);

// The wire format measures o, p and n in BMP bytes and e in Unix seconds.
export type ShareCapability = {
    v: 1;
    s: string;
    f: string;
    c: number;
    u: string;
    o: number;
    p: number;
    n: number;
    e: number;
};

export type CapabilityFailure = 'missing' | 'invalid' | 'expired';

export type CapabilityResult =
    { ok: true; capability: ShareCapability } | { ok: false; reason: CapabilityFailure };

// Padded standard base64 of exactly 32 bytes. server/src/shares/capability.ts must match it.
const CAPABILITY_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

export function validCapabilityKey(value: string): boolean {
    return CAPABILITY_KEY.test(value);
}

const keys = new Map<string, Promise<CryptoKey>>();

async function capabilityKey(secret: string): Promise<CryptoKey | null> {
    const cached = keys.get(secret);
    if (cached) return cached;

    const bytes = validCapabilityKey(secret) ? decodeBase64Url(secret) : null;
    if (!bytes) return null;

    const imported = crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
    keys.set(secret, imported);

    return imported;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

    try {
        const decoded = atob(padded);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index++)
            bytes[index] = decoded.charCodeAt(index);

        return bytes;
    } catch {
        return null;
    }
}

function validMediaUrl(value: string): boolean {
    try {
        const url = new URL(value);

        return (
            url.protocol === 'https:' &&
            MEDIA_HOSTS.has(url.hostname) &&
            url.port === '' &&
            url.username === '' &&
            url.password === '' &&
            url.hash === '' &&
            url.pathname.length > 1
        );
    } catch {
        return false;
    }
}

function validId(value: unknown, maxLength: number): boolean {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function byteCount(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validPayload(value: unknown): value is ShareCapability {
    if (!value || typeof value !== 'object') return false;

    const payload = value as Partial<ShareCapability>;

    return (
        payload.v === VERSION &&
        validId(payload.s, MAX_SHARE_ID_LENGTH) &&
        validId(payload.f, MAX_FILE_ID_LENGTH) &&
        byteCount(payload.c) &&
        typeof payload.u === 'string' &&
        payload.u.length <= MAX_URL_LENGTH &&
        validMediaUrl(payload.u) &&
        byteCount(payload.o) &&
        byteCount(payload.p) &&
        byteCount(payload.n) &&
        payload.o + payload.p <= payload.n &&
        payload.n <= MAX_TOTAL_BYTES &&
        byteCount(payload.e) &&
        payload.e > 0
    );
}

export async function readCapability(
    value: string | null,
    secret: string,
    now = Date.now()
): Promise<CapabilityResult> {
    if (!value) return { ok: false, reason: 'missing' };

    const key = await capabilityKey(secret);
    if (!key) return { ok: false, reason: 'invalid' };

    const raw = decodeBase64Url(value);
    if (!raw || raw.length <= 1 + IV_BYTES + TAG_BYTES || raw[0] !== VERSION)
        return { ok: false, reason: 'invalid' };

    const iv = raw.subarray(1, 1 + IV_BYTES);
    const sealed = raw.subarray(1 + IV_BYTES);

    try {
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, additionalData: CAPABILITY_AAD, tagLength: TAG_BYTES * 8 },
            key,
            sealed
        );
        const payload = JSON.parse(new TextDecoder().decode(plain)) as unknown;

        if (!validPayload(payload)) return { ok: false, reason: 'invalid' };
        if (payload.e * 1000 <= now) return { ok: false, reason: 'expired' };

        return { ok: true, capability: payload };
    } catch {
        return { ok: false, reason: 'invalid' };
    }
}
