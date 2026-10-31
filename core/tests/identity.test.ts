import { expect, test } from 'vitest';
import { uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

test('browser and node identities match for the same name, hash, and folder', async () => {
    const fileHash = 'ab'.repeat(32);
    const root = (await uploadIdentity('same.txt', fileHash, '')).unwrap();
    const folder = (await uploadIdentity('same.txt', fileHash, 'photos/2024')).unwrap();

    expect(root).toBe('9d0f53e7243474d5e6301b823520da3e745e54566ac475e76883ad508264b539');
    expect(folder).toBe(fileIdentity('same.txt', fileHash, undefined, 'photos/2024'));
});
