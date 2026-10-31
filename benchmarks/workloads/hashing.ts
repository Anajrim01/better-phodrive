import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
    hashFile,
    hashUploadChunk,
    uploadIdentity
} from '@madkarmaa/phodrive-core/browser/upload/hash';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { CHUNK, SIZES, files, header, type Workload } from '../fixtures';

export async function hashingWorkload(name: string): Promise<Workload | undefined> {
    if (name.startsWith('hash-')) {
        const sizes =
            name === 'hash-many' ? Array.from({ length: 500 }, () => 1024) : [SIZES[name.slice(5)]];
        const repetitions = name === 'hash-tiny' || name === 'hash-small' ? 200 : 1;
        const sources = files(sizes);
        const expected = await Promise.all(
            sources.map(async (file) => {
                const data = await file.arrayBuffer();

                return createHash('sha256').update(new Uint8Array(data)).digest('hex');
            })
        );

        return {
            bytes: sizes.reduce((a, b) => a + b, 0) * repetitions,
            run: async () => {
                for (let repeat = 0; repeat < repetitions; repeat++)
                    for (const [index, file] of sources.entries()) {
                        const fresh = new File([file], file.name);
                        const result = await hashFile(fresh, () => {});
                        assert.equal(result.unwrap(), expected[index]);
                    }
            }
        };
    }

    if (name === 'identity')
        return {
            bytes: 0,
            run: async () => {
                for (let i = 0; i < 1000; i++) {
                    const result = await uploadIdentity(`file-${i}`, 'ab'.repeat(32));
                    assert.equal(result.unwrap().length, 64);
                }
            }
        };

    if (!name.startsWith('chunk-hash')) return undefined;

    const size = name.endsWith('small') ? 1024 : CHUNK;
    const payload = new Blob([new Uint8Array(size).fill(42)]);
    const encoded = encodeSplitBmp(new Uint8Array(size).fill(42), header(size)).unwrap();
    const expected = createHash('sha1').update(encoded).digest('hex');
    const count = size === 1024 ? 500 : 1;

    return {
        bytes: size * count,
        run: async () => {
            for (let i = 0; i < count; i++) {
                const result = await hashUploadChunk(payload, header(size));
                assert.equal(result.unwrap().sha1, expected);
            }
        }
    };
}
