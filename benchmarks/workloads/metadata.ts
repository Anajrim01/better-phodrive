import assert from 'node:assert/strict';
import { encodeSplitPrefix } from '@madkarmaa/phodrive-core/bmp/format';
import { planChunks } from '@madkarmaa/phodrive-core/upload';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { header, MIB, type Workload } from '../fixtures';

export function metadataWorkload(name: string): Workload | undefined {
    if (name === 'planning')
        return {
            bytes: 0,
            run: () => {
                for (let i = 0; i < 20; i++) {
                    const plan = planChunks(
                        {
                            name: 'archive.bin',
                            size: 500_000_000_000 + i,
                            fileHash: 'ab'.repeat(32)
                        },
                        'cd'.repeat(32)
                    ).unwrap();
                    assert.equal(
                        plan.headers.reduce((sum, part) => sum + part.payloadSize, 0),
                        500_000_000_000 + i
                    );
                }
            }
        };

    if (name === 'prefix')
        return {
            bytes: 0,
            run: () => {
                for (let i = 0; i < 10_000; i++)
                    assert.ok(encodeSplitPrefix(header(i)).unwrap().prefix.length > 100);
            }
        };

    if (name !== 'bmp-encode') return undefined;

    const data = new Uint8Array(64 * MIB).fill(42);

    return {
        bytes: data.length,
        run: () => {
            const result = encodeSplitBmp(data, header(data.length)).unwrap();
            assert.equal(result[1000], 42);
        }
    };
}
