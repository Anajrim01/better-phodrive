import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Brotli WASM integrity', () => {
    it('pins the served WASM file to its SRI hash', () => {
        const source = readFileSync(new URL('../src/brotli.ts', import.meta.url), 'utf8');
        const pinned = /BROTLI_WASM_SRI\s*=\s*'([^']+)'/.exec(source)?.[1];
        const wasm = readFileSync(
            new URL('../node_modules/brotli-dec-wasm/pkg/brotli_dec_wasm_bg.wasm', import.meta.url)
        );
        const digest = `sha384-${createHash('sha384').update(wasm).digest('base64')}`;

        expect(pinned).toBe(digest);
    });
});
