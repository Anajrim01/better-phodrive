import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { IHasher } from 'hash-wasm';
import { parseChunkPrefix, type ChunkHeader } from './bmp';
import { viewerFailure, type ViewerFailure } from './errors';
import type { ByteSink } from './sink';

export type Decompressor = (
    bytes: Uint8Array,
    originalSize: number
) => AsyncResult<Uint8Array, ViewerFailure>;

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first);
    bytes.set(second, first.length);

    return bytes;
}

function sameHeader(first: ChunkHeader, second: ChunkHeader): boolean {
    return (
        first.fileHash === second.fileHash &&
        first.fileId === second.fileId &&
        first.chunkIndex === second.chunkIndex &&
        first.flags === second.flags &&
        first.payloadSize === second.payloadSize &&
        first.originalSize === second.originalSize &&
        first.fileName === second.fileName &&
        first.folder === second.folder &&
        first.totalSize === second.totalSize &&
        first.payloadOffset === second.payloadOffset &&
        first.paddingSize === second.paddingSize
    );
}

function updateHasher(hasher: IHasher, bytes: Uint8Array): Result<void, ViewerFailure> {
    try {
        hasher.update(bytes);

        return Ok(undefined);
    } catch {
        return Err(viewerFailure('integrity_failed', 'The file hash could not be calculated.'));
    }
}

export class ChunkConsumer {
    private prefix: Uint8Array = new Uint8Array(0);
    private headerReady = false;
    private received = 0;
    private payloadRemaining = 0;
    private paddingRemaining = 0;
    private written = 0;
    private payloadBuffer: Uint8Array | null = null;
    private payloadFill = 0;

    private constructor(
        private readonly expected: ChunkHeader,
        private readonly sink: ByteSink,
        private readonly hasher: IHasher,
        private readonly decompress: Decompressor,
        private readonly onProgress: (written: number) => void,
        private readonly baseWritten: number
    ) {}

    static create(
        expected: ChunkHeader,
        sink: ByteSink,
        hasher: IHasher,
        decompress: Decompressor,
        onProgress: (written: number) => void,
        baseWritten: number
    ): ChunkConsumer {
        return new ChunkConsumer(expected, sink, hasher, decompress, onProgress, baseWritten);
    }

    private acceptHeader(block: Uint8Array): AsyncResult<Uint8Array, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            this.prefix = concat(this.prefix, block);
            const needed = this.expected.payloadOffset;
            if (this.prefix.length < needed) return Ok(new Uint8Array(0));

            const prefix = this.prefix.subarray(0, needed);
            return parseChunkPrefix(prefix).match({
                Err: (error) => Err(error),
                Ok: (header) => {
                    if (!sameHeader(header, this.expected))
                        return Err(
                            viewerFailure(
                                'chunk_invalid',
                                'A chunk changed after it was inspected.'
                            )
                        );

                    this.headerReady = true;
                    this.payloadRemaining = header.payloadSize;
                    this.paddingRemaining = header.paddingSize;

                    if (header.compressed) this.payloadBuffer = new Uint8Array(header.payloadSize);

                    return Ok(this.prefix.subarray(needed));
                }
            });
        });
    }

    private writePayload(bytes: Uint8Array): AsyncResult<void, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            if (bytes.length === 0) return Ok(undefined);

            const written = await this.sink.write(bytes);
            if (written.isErr()) return written;

            const hashed = updateHasher(this.hasher, bytes);
            if (hashed.isErr()) return hashed;

            this.written += bytes.length;
            this.onProgress(this.baseWritten + this.written);

            return Ok(undefined);
        });
    }

    private pushPayload(block: Uint8Array): AsyncResult<Uint8Array, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            let offset = 0;

            if (this.payloadRemaining > 0) {
                const take = Math.min(this.payloadRemaining, block.length - offset);
                const payload = block.subarray(offset, offset + take);
                offset += take;
                this.payloadRemaining -= take;

                if (this.payloadBuffer) {
                    this.payloadBuffer.set(payload, this.payloadFill);
                    this.payloadFill += payload.length;
                } else {
                    const written = await this.writePayload(payload);
                    if (written.isErr()) return written;
                }
            }

            const padding = block.subarray(offset);
            if (padding.length > this.paddingRemaining)
                return Err(
                    viewerFailure('chunk_invalid', 'A chunk has bytes past its declared size.')
                );

            for (const byte of padding) {
                if (byte !== 0)
                    return Err(viewerFailure('chunk_invalid', 'A chunk has non-zero padding.'));
            }
            this.paddingRemaining -= padding.length;

            return Ok(new Uint8Array(0));
        });
    }

    push(block: Uint8Array): AsyncResult<void, ViewerFailure> {
        this.received += block.length;
        if (this.received > this.expected.totalSize)
            return Ok(undefined).andThenAsync(async () =>
                Err(viewerFailure('chunk_invalid', 'A chunk is longer than its declared size.'))
            );

        if (this.headerReady) return this.pushPayload(block).map(() => undefined);

        return this.acceptHeader(block).andThenAsync((remaining) =>
            this.pushPayload(remaining).map(() => undefined)
        );
    }

    finish(): AsyncResult<number, ViewerFailure> {
        return Ok(undefined).andThenAsync(async () => {
            if (
                !this.headerReady ||
                this.received !== this.expected.totalSize ||
                this.payloadRemaining !== 0 ||
                this.paddingRemaining !== 0
            )
                return Err(viewerFailure('share_incomplete', 'A chunk ended early.'));

            if (!this.payloadBuffer) return Ok(this.written);

            const originalSize = this.expected.originalSize;
            if (originalSize === undefined)
                return Err(
                    viewerFailure('chunk_invalid', 'A compressed chunk has no declared size.')
                );

            const buffer = this.payloadBuffer;
            return this.decompress(buffer, originalSize)
                .andThen((decompressed) =>
                    decompressed.length === this.expected.originalSize
                        ? Ok(decompressed)
                        : Err(
                              viewerFailure(
                                  'integrity_failed',
                                  'A compressed chunk has the wrong size.'
                              )
                          )
                )
                .andThenAsync((decompressed) =>
                    this.writePayload(decompressed).map(() => this.written)
                );
        });
    }
}
