import { Err, Ok, type AsyncResult } from 'results-ts';
import initBrotli, { BrotliDecStream } from 'brotli-dec-wasm/web';
import wasmUrl from 'brotli-dec-wasm/web/bg.wasm?url';
import { decodeBounded } from './brotli-decode';
import { viewerFailure, type ViewerFailure } from './errors';

const BROTLI_WASM_SRI = 'sha384-j+9fIg/IGKCbeQUGsFGU8eJ7AgMfJU6h0SruIfEoxLkFxgJV9ZfT7YVL86vfgPP3';

let ready: Promise<void> | null = null;

async function initialize(): Promise<void> {
    const response = await fetch(wasmUrl, {
        integrity: BROTLI_WASM_SRI,
        cache: 'force-cache'
    });
    if (!response.ok) throw new Error('Brotli decoder was not available');

    await initBrotli({ module_or_path: response });
}

export function decompressChunk(
    bytes: Uint8Array,
    originalSize: number
): AsyncResult<Uint8Array, ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => {
        try {
            ready ??= initialize();
            await ready;

            return decodeBounded(new BrotliDecStream(), bytes, originalSize);
        } catch {
            ready = null;

            return Err(
                viewerFailure('chunk_invalid', 'A compressed chunk could not be decompressed.')
            );
        }
    });
}
