import { createBrotliDecompress, type BrotliDecompress } from 'node:zlib';
import { Err, Ok, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';

/**
 * Decode one stored Brotli chunk incrementally. Output never exceeds the declared original size,
 * and a stream that ends short or long is a decompression failure.
 */
export class BrotliStreamDecoder {
    private readonly decoder: BrotliDecompress;
    private readonly outputs: Uint8Array[] = [];
    private failure: ServerError | null = null;
    private rejectPending: ((reason: unknown) => void) | null = null;
    private produced = 0;

    constructor(private readonly originalSize: number) {
        this.decoder = createBrotliDecompress();
        this.decoder.on('data', (chunk: Buffer) => {
            this.produced += chunk.length;
            if (this.produced > this.originalSize) {
                this.fail();

                return;
            }

            this.outputs.push(chunk);
        });
        this.decoder.on('error', () => this.fail());
    }

    async push(part: Uint8Array): Promise<Result<Uint8Array[], ServerError>> {
        if (this.failure) return Err(this.failure);

        try {
            await new Promise<void>((resolve, reject) => {
                this.rejectPending = reject;
                this.decoder.write(part, (error: Error | null | undefined) => {
                    this.rejectPending = null;
                    error ? reject(SERVER_ERRORS.DECOMPRESSION_FAILED) : resolve();
                });
            });
        } catch {
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
        }
        if (this.failure) return Err(this.failure);

        return Ok(this.outputs.splice(0));
    }

    async end(): Promise<Result<Uint8Array[], ServerError>> {
        if (this.failure) return Err(this.failure);

        try {
            await new Promise<void>((resolve, reject) => {
                this.rejectPending = reject;
                this.decoder.end((error: Error | null | undefined) => {
                    this.rejectPending = null;
                    error ? reject(SERVER_ERRORS.DECOMPRESSION_FAILED) : resolve();
                });
            });
        } catch {
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);
        }
        if (this.failure || this.produced !== this.originalSize)
            return Err(SERVER_ERRORS.DECOMPRESSION_FAILED);

        return Ok(this.outputs.splice(0));
    }

    destroy(): void {
        this.outputs.length = 0;
        this.failure ??= SERVER_ERRORS.DECOMPRESSION_FAILED;
        this.rejectPending?.(this.failure);
        this.rejectPending = null;

        try {
            this.decoder.destroy();
        } catch {
            // The decoder may already be closed by an error.
        }
    }

    private fail(): void {
        this.failure = SERVER_ERRORS.DECOMPRESSION_FAILED;
        this.outputs.length = 0;
        this.rejectPending?.(this.failure);
        this.rejectPending = null;
        this.decoder.destroy();
    }
}
