import { readFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { BrotliDecStream } from 'brotli-dec-wasm/web';
import { decodeBounded } from '../src/brotli-decode';

beforeAll(async () => {
    const wasm = readFileSync(
        new URL('../node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm_bg.wasm', import.meta.url)
    );

    await init({ module_or_path: wasm });
});

describe('bounded Brotli decoder', () => {
    it('decodes a normal chunk to its exact size', () => {
        const output = Buffer.from('phodrive '.repeat(500));
        const compressed = brotliCompressSync(output);
        const decoded = decodeBounded(new BrotliDecStream(), compressed, output.length);

        expect(decoded.unwrap()).toEqual(new Uint8Array(output));
    });

    it('stops a real WASM bomb at the declared output size', () => {
        const bomb = brotliCompressSync(Buffer.alloc(8_000_000, 65));
        const decoded = decodeBounded(new BrotliDecStream(), bomb, 1_024);

        expect(decoded.unwrapErr().code).toBe('integrity_failed');
    });

    it('rejects a truncated stream', () => {
        const compressed = brotliCompressSync(Buffer.from('short'));
        const decoded = decodeBounded(
            new BrotliDecStream(),
            compressed.subarray(0, 3),
            'short'.length
        );

        expect(decoded.unwrapErr().code).toBe('integrity_failed');
    });

    it('rejects trailing bytes after a valid stream', () => {
        const compressed = brotliCompressSync(Buffer.from('short'));
        const decoded = decodeBounded(
            new BrotliDecStream(),
            Buffer.concat([compressed, Buffer.from('junk')]),
            'short'.length
        );

        expect(decoded.unwrapErr().code).toBe('integrity_failed');
    });
});
