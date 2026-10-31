import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { encodeSplitPrefix } from '../../bmp/format';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    splitHeaderIsCompressed,
    type SplitHeader
} from '../../models';
import {
    COMPRESSION_MIN_BYTES,
    COMPRESSION_PROBE_BYTES,
    compressPayload,
    compressionEnabled,
    probeCompressible
} from '../compress';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';

const TRANSFER_BLOCK_BYTES = 64 * 1024;

export interface UploadBmpSource {
    body: ReadableStream<Uint8Array>;
    length: number;
    sha1: string;
    originalSize: number;
    storedSize: number;
    compressed: boolean;
    last: boolean;
    verified: AsyncResult<void, ServerError>;
    drain: () => AsyncResult<void, ServerError>;
}

interface PayloadProbe {
    bytes: Uint8Array;
    pending: Uint8Array;
    reader: ReadableStreamDefaultReader<Uint8Array>;
    done: boolean;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
        await reader.cancel();
    } catch {
        // The caller already has a receive error to report.
    }
}

/** Read only the first probe, leaving the rest of the stream available for raw forwarding. */
function readProbe(input: ReceivedUpload): AsyncResult<PayloadProbe, ServerError> {
    return Ok(undefined).andThenAsync<PayloadProbe, ServerError>(async () => {
        const size = Math.min(input.header.payloadSize, COMPRESSION_PROBE_BYTES);
        const reader = input.payload.getReader();
        const bytes = new Uint8Array(size);
        let filled = 0;
        let pending: Uint8Array = new Uint8Array();
        let done = false;

        try {
            while (filled < size) {
                const next = await reader.read();
                if (next.done) {
                    done = true;
                    break;
                }

                const needed = size - filled;
                const copied = Math.min(needed, next.value.length);
                bytes.set(next.value.subarray(0, copied), filled);
                filled += copied;
                if (next.value.length > copied) pending = next.value.subarray(copied);
            }
        } catch {
            await cancelReader(reader);
            reader.releaseLock();

            return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
        }

        return Ok({ bytes: bytes.subarray(0, filled), pending, reader, done });
    });
}

/** The probe cleared the threshold, so buffer the full chunk before compressing it. */
function readCompressPayload(
    input: ReceivedUpload,
    probe: PayloadProbe
): AsyncResult<Uint8Array, ServerError> {
    return Ok(undefined).andThenAsync<Uint8Array, ServerError>(async () => {
        const expected = input.header.payloadSize;
        const payload = new Uint8Array(expected);
        let received = 0;
        let failed = false;

        const copy = (bytes: Uint8Array): boolean => {
            if (received + bytes.length > expected) return false;

            payload.set(bytes, received);
            received += bytes.length;

            return true;
        };

        try {
            if (!copy(probe.bytes) || !copy(probe.pending)) {
                failed = true;

                return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);
            }

            while (!probe.done) {
                const next = await probe.reader.read();
                if (next.done) {
                    probe.done = true;
                    break;
                }
                if (!copy(next.value)) {
                    failed = true;

                    return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);
                }
            }
        } catch {
            failed = true;

            return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
        } finally {
            if (failed) await cancelReader(probe.reader);
            probe.reader.releaseLock();
        }

        if (received !== expected) return Err(SERVER_ERRORS.INCOMPLETE_FILE);

        return Ok(payload);
    });
}

/** Rebuild the byte stream from bytes already read plus the unread payload. */
function prependPayload(probe: PayloadProbe): ReadableStream<Uint8Array> {
    const initial = [probe.bytes, probe.pending];
    let index = 0;

    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                while (index < initial.length) {
                    const block = initial[index];
                    index++;
                    if (block.length) {
                        controller.enqueue(block);

                        return;
                    }
                }
                if (probe.done) {
                    controller.close();

                    return;
                }

                try {
                    const next = await probe.reader.read();
                    if (next.done) {
                        probe.done = true;
                        controller.close();

                        return;
                    }

                    controller.enqueue(next.value);
                } catch {
                    controller.error(SERVER_ERRORS.FILE_RECEIVE_FAILED);
                }
            },
            async cancel() {
                await cancelReader(probe.reader);
                probe.reader.releaseLock();
            }
        },
        { highWaterMark: 0 }
    );
}

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

/** Compression off: stream prefix, raw payload, and padding without buffering a chunk. */
function rawUploadSource(
    input: ReceivedUpload,
    payload: ReadableStream<Uint8Array> = input.payload
): UploadBmpSource {
    const hash = createHash('sha1');
    const reader = payload.getReader();
    const zeros = new Uint8Array(TRANSFER_BLOCK_BYTES);
    let phase: 'prefix' | 'payload' | 'padding' = 'prefix';
    let closed = false;
    let received = 0;
    let padding = input.bmp.paddingSize;
    let pending: Uint8Array = new Uint8Array();
    let settle: (result: Result<void, ServerError>) => void = () => {};
    const verification = new Promise<Result<void, ServerError>>((resolve) => {
        settle = resolve;
    });
    const cleanup = async () => {
        closed = true;
        pending = new Uint8Array();

        try {
            await reader.cancel();
        } catch {
            // Preserve the verification or transport error if cancellation fails.
        } finally {
            reader.releaseLock();
        }
    };
    const body = new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                const fail = async (error: ServerError) => {
                    settle(Err(error));
                    controller.error(error);
                    await cleanup();
                };
                if (closed) return;
                if (phase === 'prefix') {
                    phase = 'payload';
                    hash.update(input.bmp.prefix);
                    controller.enqueue(input.bmp.prefix);

                    return;
                }
                if (phase === 'payload') {
                    if (!pending.length) {
                        let next: ReadableStreamReadResult<Uint8Array>;

                        try {
                            next = await reader.read();
                        } catch {
                            await fail(SERVER_ERRORS.FILE_RECEIVE_FAILED);

                            return;
                        }
                        if (closed) return;
                        if (!next.done) {
                            received += next.value.length;
                            if (received > input.header.payloadSize) {
                                await fail(SERVER_ERRORS.INVALID_CHUNK_SIZE);

                                return;
                            }

                            pending = next.value;
                        } else {
                            if (received !== input.header.payloadSize) {
                                await fail(SERVER_ERRORS.INCOMPLETE_FILE);

                                return;
                            }

                            const finished = await input.finished();
                            if (closed) return;

                            const failure = finished.match({
                                Ok: () => null,
                                Err: (error) => error
                            });
                            if (failure) {
                                await fail(failure);

                                return;
                            }

                            phase = 'padding';
                        }
                    }
                    if (pending.length) {
                        const block = pending.subarray(0, TRANSFER_BLOCK_BYTES);
                        pending = pending.subarray(block.length);
                        hash.update(block);
                        controller.enqueue(block);

                        return;
                    }
                }
                if (padding > 0) {
                    const block = zeros.subarray(0, padding);
                    padding -= block.length;
                    hash.update(block);
                    controller.enqueue(block);

                    return;
                }
                if (hash.digest('hex') !== input.sha1) {
                    await fail(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);

                    return;
                }

                closed = true;
                reader.releaseLock();
                settle(Ok(undefined));
                controller.close();
            },
            async cancel() {
                settle(Err(SERVER_ERRORS.FILE_RECEIVE_FAILED));
                await cleanup();
            }
        },
        { highWaterMark: 0 }
    );
    const verified = Ok(undefined).and(verification);

    return {
        body,
        verified,
        length: input.bmp.totalSize,
        sha1: input.sha1,
        originalSize: input.header.payloadSize,
        storedSize: input.header.payloadSize,
        compressed: false,
        last: (input.header.flags & SPLIT_FLAG_LAST) !== 0,
        drain: () =>
            Ok(undefined).andThenAsync(async () => {
                const bmpReader = body.getReader();

                try {
                    while (true) {
                        const next = await bmpReader.read();
                        if (next.done) break;
                    }
                } catch {
                    return await verified;
                } finally {
                    bmpReader.releaseLock();
                }

                return await verified;
            })
    };
}

/** Encode and verify a BMP in fixed-sized pieces before permitting the Google commit. */
export function encodeUploadBmp(input: ReceivedUpload): AsyncResult<UploadBmpSource, ServerError> {
    if (!compressionEnabled() || input.header.payloadSize < COMPRESSION_MIN_BYTES)
        return Ok(undefined).andThenAsync(async () => Ok(rawUploadSource(input)));

    return readProbe(input).andThenAsync(async (probe) => {
        if (!probeCompressible(probe.bytes))
            return Ok(rawUploadSource(input, prependPayload(probe)));

        const received = await readCompressPayload(input, probe);
        return received.andThenAsync(async (payload) => {
            let buffer = payload;
            const rawSha1Value = rawSha1(input, buffer);
            if (rawSha1Value !== input.sha1) return Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);

            const finished = await input.finished();
            if (finished.isErr()) return finished;

            const encodedResult = await encodeUpload(input, buffer, rawSha1Value);
            // Compression copies what it needs; drop the only reference to the raw chunk.
            buffer = new Uint8Array(0);
            if (encodedResult.isErr()) return encodedResult;

            return encodedResult.map((encoded) => {
                let settle: (result: Result<void, ServerError>) => void = () => {};
                const verification = new Promise<Result<void, ServerError>>((resolve) => {
                    settle = resolve;
                });
                const body = uploadBody(
                    encoded,
                    input.signal,
                    () => settle(Err(SERVER_ERRORS.FILE_RECEIVE_FAILED)),
                    () => settle(Ok(undefined))
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
                                        settle(Ok(undefined));
                                        break;
                                    }
                                }
                            } catch {
                                return await verification;
                            } finally {
                                bmpReader.releaseLock();
                            }

                            return await verification;
                        })
                };
            });
        });
    });
}
