import { createCipheriv, randomBytes } from 'node:crypto';

export const SHARE_CAPABILITY_TTL_MS = 5 * 60_000;

const VERSION = 1;
const IV_BYTES = 12;
const AAD = Buffer.from('phodrive-share-capability-v1');

// Padded standard base64 of exactly 32 bytes. web/functions/_lib/capability.ts must match it.
const CAPABILITY_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

export function validCapabilityKey(value: string): boolean {
    return CAPABILITY_KEY.test(value);
}

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

export function encodeCapability(
    payload: ShareCapability,
    key: Buffer,
    iv = randomBytes(IV_BYTES)
): string {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final()
    ]);

    return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, cipher.getAuthTag()]).toString(
        'base64url'
    );
}
