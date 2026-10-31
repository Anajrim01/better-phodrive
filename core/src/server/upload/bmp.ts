import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { encodeSplitPrefix } from '../../bmp/format';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    splitHeaderIsCompressed,
    type SplitHeader
} from '../../models';
import { COMPRESSION_MIN_BYTES, compressPayload, probeCompressible } from '../compress';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';
import { prependPayload, readCompressPayload, readProbe } from './probe';
import { rawUploadSource } from './raw';
import { TRANSFER_BLOCK_BYTES, type UploadBmpSource } from './source';

export type { UploadBmpSource } from './source';

const BUFFERED_UPLOAD_LIMIT = 2;

class UploadSlots {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    async acquire(signal: AbortSignal): Promise<boolean> {
        if (signal.aborted) return false;
        if (this.active < BUFFERED_UPLOAD_LIMIT) {
            this.active++;

            return true;
        }

        return new Promise((resolve) => {
            const resume = () => {
                signal.removeEventListener('abort', onAbort);
                this.active++;
                resolve(true);
            };
            const onAbort = () => {
                const index = this.waiters.indexOf(resume);
                if (index >= 0) this.waiters.splice(index, 1);

                resolve(false);
            };

            this.waiters.push(resume);
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    release(): void {
        this.active = Math.max(0, this.active - 1);
        this.waiters.shift()?.();
    }
}

const uploadSlots = new UploadSlots();

function hashZeros(hash: ReturnType<typeof createHash>, size: number): void {
    if (!size) return;

    const zeros = new Uint8Array(Math.min(size, TRANSFER_BLOCK_BYTES));
    let remaining = size;
    while (remaining > 0) {
        const block = zeros.subarray(0, Math.min(remaining, zeros.length));
        hash.update(block);
        remaining -= block.length;
    }
}

function rawSha1(input: ReceivedUpload, payload: Uint8Array): string {
    const hash = createHash('sha1');
    hash.update(input.bmp.prefix);
    hash.update(payload);
    hashZeros(hash, input.bmp.paddingSize);

    return hash.digest('hex');
}

interface EncodedUpload {
    header: SplitHeader;
    prefix: Uint8Array<ArrayBuffer>;
    data: Uint8Array;
    totalSize: number;
    paddingSize: number;
    sha1: string;
}

function encodeUpload(
    input: ReceivedUpload,
    payload: Uint8Array,
    rawSha1Value: string
): AsyncResult<EncodedUpload, ServerError> {
    return compressPayload(payload).andThen((stored) => {
        const flags =
            (input.header.flags & SPLIT_FLAG_LAST) |
            (stored.compressed ? SPLIT_FLAG_COMPRESSED : 0);
        const header: SplitHeader = {
            ...input.header,
            flags,
            payloadSize: stored.storedSize,
            originalSize: stored.compressed ? stored.originalSize : undefined
        };

        return encodeSplitPrefix(header).map((layout) => {
            const { prefix, totalSize, paddingSize } = layout;
            let sha1 = rawSha1Value;

            if (stored.compressed) {
                const hash = createHash('sha1');
                hash.update(prefix);
                hash.update(stored.data);
                hashZeros(hash, paddingSize);
                sha1 = hash.digest('hex');
            }

            return {
                header,
                prefix,
                data: stored.data,
                totalSize,
                paddingSize,
                sha1
            };
        });
    });
}

function uploadBody(
    encoded: EncodedUpload,
    signal: AbortSignal,
    onCancel: () => void,
    onComplete: () => void
): ReadableStream<Uint8Array> {
    const zeros = new Uint8Array(TRANSFER_BLOCK_BYTES);
    let phase: 'prefix' | 'payload' | 'padding' | 'done' = 'prefix';
    let offset = 0;
    let padding = encoded.paddingSize;

    return new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (signal.aborted) {
                    onCancel();
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                    return;
                }
                if (phase === 'prefix') {
                    phase = 'payload';
                    controller.enqueue(encoded.prefix);

                    return;
                }
                if (phase === 'payload') {
                    if (offset < encoded.data.length) {
                        const block = encoded.data.subarray(offset, offset + TRANSFER_BLOCK_BYTES);
                        offset += block.length;
                        controller.enqueue(block);

                        return;
                    }
                    phase = 'padding';
                }
                if (phase === 'padding' && padding > 0) {
                    const block = zeros.subarray(0, Math.min(padding, zeros.length));
                    padding -= block.length;
                    controller.enqueue(block);

                    return;
                }

                phase = 'done';
                onComplete();
                controller.close();
            },
            cancel() {
                onCancel();
            }
        },
        { highWaterMark: 0 }
    );
}

/** Encode and verify a BMP in fixed-sized pieces before permitting the Google commit. */
export function encodeUploadBmp(input: ReceivedUpload): AsyncResult<UploadBmpSource, ServerError> {
    if (!input.compress || input.header.payloadSize < COMPRESSION_MIN_BYTES)
        return Ok(undefined).andThenAsync(async () => Ok(rawUploadSource(input)));

    return readProbe(input).andThenAsync(async (probe) => {
        if (!probeCompressible(probe.bytes))
            return Ok(rawUploadSource(input, prependPayload(probe)));

        const acquired = await uploadSlots.acquire(input.signal);
        if (!acquired) return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);

        let released = false;
        const release = () => {
            if (released) return;

            released = true;
            uploadSlots.release();
        };
        input.signal.addEventListener('abort', release, { once: true });

        const prepared = await readCompressPayload(input, probe).andThenAsync(async (payload) => {
            let buffer = payload;
            const rawSha1Value = rawSha1(input, buffer);
            if (rawSha1Value !== input.sha1) {
                release();

                return Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);
            }

            const finished = await input.finished();
            if (finished.isErr()) {
                release();

                return finished;
            }

            const encodedResult = await encodeUpload(input, buffer, rawSha1Value);
            // Compression copies what it needs; drop the only reference to the raw chunk.
            buffer = new Uint8Array(0);
            if (encodedResult.isErr()) {
                release();

                return encodedResult;
            }

            return encodedResult.map((encoded) => {
                let settle: (result: Result<void, ServerError>) => void = () => {};
                const verification = new Promise<Result<void, ServerError>>((resolve) => {
                    settle = resolve;
                });
                const body = uploadBody(
                    encoded,
                    input.signal,
                    () => {
                        release();
                        settle(Err(SERVER_ERRORS.FILE_RECEIVE_FAILED));
                    },
                    () => {
                        release();
                        settle(Ok(undefined));
                    }
                );

                return {
                    body,
                    length: encoded.totalSize,
                    sha1: encoded.sha1,
                    originalSize: input.header.payloadSize,
                    storedSize: encoded.header.payloadSize,
                    compressed: splitHeaderIsCompressed(encoded.header.flags),
                    last: (encoded.header.flags & SPLIT_FLAG_LAST) !== 0,
                    verified: Ok(undefined).and(verification),
                    drain: () =>
                        Ok(undefined).andThenAsync(async () => {
                            const bmpReader = body.getReader();

                            try {
                                while (true) {
                                    const next = await bmpReader.read();
                                    if (next.done) {
                                        release();
                                        settle(Ok(undefined));
                                        break;
                                    }
                                }
                            } catch {
                                release();

                                return await verification;
                            } finally {
                                bmpReader.releaseLock();
                            }

                            return await verification;
                        })
                };
            });
        });
        if (prepared.isErr()) release();

        return prepared;
    });
}
