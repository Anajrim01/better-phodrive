import { expect, test } from 'vitest';
import { uploadIdentity } from '@madkarmaa/phodrive-core/browser/upload/hash';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

test('browser and node identities match for the same name, hash, and folder', async () => {
    const fileHash = 'ab'.repeat(32);

    for (const folder of ['', 'photos/2024']) {
        const browser = (await uploadIdentity('same.txt', fileHash, folder)).unwrap();

        expect(browser).toBe(fileIdentity('same.txt', fileHash, undefined, folder));
    }
});
