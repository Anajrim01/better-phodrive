import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SplitBmpReader } from '@madkarmaa/phodrive-core/server/bmp/stream';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { encodeUploadBmp } from '@madkarmaa/phodrive-core/server/upload/bmp';
import { uploadForm } from '../../core/tests/helpers/upload';
import { CHUNK, MIB, blocks, header, type Workload } from '../fixtures';

export async function transferWorkload(name: string): Promise<Workload | undefined> {
    if (name === 'bmp-stream') {
        const fixture = uploadForm(new Uint8Array(CHUNK).fill(42), 'fixture.bin', {
            compress: true
        });

        return {
            bytes: CHUNK,
            run: async () => {
                const received = await receiveUpload(fixture.request());
                const input = received.unwrap();
                const encoded = await encodeUploadBmp(input);
                assert.ok(encoded.isOk());
                const result = await encoded.unwrap().drain();
                assert.ok(result.isOk());
                await input.cancel();
            }
        };
    }

    if (name === 'download-stream') {
        const data = new Uint8Array(64 * MIB).fill(42);
        const metadata = header(data.length);
        const bmp = encodeSplitBmp(data, metadata).unwrap();
        const sha1 = createHash('sha1').update(bmp).digest('hex');

        return {
            bytes: data.length,
            run: async () => {
                const opened = await SplitBmpReader.open(new Response(blocks(bmp)), metadata, sha1);
                const reader = opened.unwrap();
                let length = 0;
                while (true) {
                    const next = await reader.readPayload();
                    const part = next.unwrap();
                    if (part === null) break;
                    length += part.length;
                }
                assert.equal(length, data.length);
            }
        };
    }

    if (name !== 'failure-paths') return undefined;

    const fixture = uploadForm(new Uint8Array(MIB).fill(42), 'fixture.bin', {
        compress: true
    });

    return {
        bytes: 0,
        run: async () => {
            const invalid = await receiveUpload(
                new Request('http://localhost/api/upload', { method: 'POST', body: 'bad' })
            );
            assert.ok(invalid.isErr());
            for (const mode of ['hash', 'short', 'cancel', 'stream']) {
                const received = await receiveUpload(fixture.request());
                const input = received.unwrap();
                if (mode === 'hash') input.sha1 = '0'.repeat(40);
                if (mode === 'short') input.header.payloadSize++;
                if (mode === 'stream') {
                    await input.cancel();
                    input.payload = new ReadableStream({
                        pull(controller) {
                            controller.error(new Error('failed stream'));
                        }
                    });
                }
                const encoded = await encodeUploadBmp(input);
                if (mode === 'cancel') {
                    assert.ok(encoded.isOk());
                    const source = encoded.unwrap();
                    await source.body.cancel();
                    const verified = await source.verified;
                    assert.ok(verified.isErr());
                } else {
                    assert.ok(encoded.isErr());
                }
                await input.cancel();
            }
        }
    };
}
