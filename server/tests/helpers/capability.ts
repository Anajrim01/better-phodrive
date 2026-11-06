import { createDecipheriv } from 'node:crypto';
import { Err, Ok, type Result } from 'results-ts';
import type { ShareCapability } from '../../src/shares';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function decodeCapability(token: string, key: Buffer): Result<ShareCapability, string> {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(Buffer.from('phodrive-share-capability-v1'));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));

    try {
        const plain = Buffer.concat([
            decipher.update(raw.subarray(1 + IV_BYTES, raw.length - TAG_BYTES)),
            decipher.final()
        ]);

        return Ok(JSON.parse(plain.toString('utf8')) as ShareCapability);
    } catch {
        return Err('capability authentication failed');
    }
}
