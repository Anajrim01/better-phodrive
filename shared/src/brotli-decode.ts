import { Err, Ok, type Result } from 'results-ts';
import { BrotliStreamResultCode, type BrotliDecStream } from 'brotli-dec-wasm/web';
import { viewerFailure, type ViewerFailure } from './errors';

export function decodeBounded(
    stream: BrotliDecStream,
    bytes: Uint8Array,
    originalSize: number
): Result<Uint8Array, ViewerFailure> {
    try {
        const result = stream.decompress(bytes, originalSize + 1);

        try {
            if (result.code !== BrotliStreamResultCode.ResultSuccess)
                return Err(
                    viewerFailure(
                        'integrity_failed',
                        'A compressed chunk expanded past its declared size.'
                    )
                );
            if (result.buf.length !== originalSize)
                return Err(
                    viewerFailure('integrity_failed', 'A compressed chunk has the wrong size.')
                );
            if (result.input_offset !== bytes.length)
                return Err(
                    viewerFailure('integrity_failed', 'A compressed chunk has trailing data.')
                );

            return Ok(result.buf);
        } finally {
            result.free();
        }
    } catch {
        return Err(viewerFailure('chunk_invalid', 'A compressed chunk could not be decompressed.'));
    } finally {
        stream.free();
    }
}
