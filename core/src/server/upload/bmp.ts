import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { encodeSplitPrefix } from '../../bmp/format';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    splitHeaderIsCompressed,
    type SplitHeader
} from '../../models';
import { compressPayload } from '../compress';
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

function readPayload(input: ReceivedUpload): AsyncResult<Uint8Array, ServerError> {
    return Ok(undefined).andThenAsync<Uint8Array, ServerError>(async () => {
        const expected = input.header.payloadSize;
        const payload = new Uint8Array(expected);
        const reader = input.payload.getReader();
        let received = 0;

        try {
            while (true) {
                const next = await reader.read();
                if (next.done) break;

                if (received + next.value.length > expected)
                    return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);

                payload.set(next.value, received);
                received += next.value.length;
            }
        } catch {
            return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
        } finally {
            reader.releaseLock();
        }
        if (received !== expected) return Err(SERVER_ERRORS.INCOMPLETE_FILE);

        return Ok(payload);
    });
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
            const hash = createHash('sha1');
            hash.update(prefix);
            hash.update(stored.data);
            hashZeros(hash, paddingSize);

            return {
                header,
                prefix,
                data: stored.data,
                totalSize,
                paddingSize,
                sha1: stored.compressed ? hash.digest('hex') : rawSha1Value
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
    return readPayload(input).andThenAsync(async (payload) => {
        const rawSha1Value = rawSha1(input, payload);
        if (rawSha1Value !== input.sha1) return Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);

        const finished = await input.finished();
        if (finished.isErr()) return finished;

        const encodedResult = await encodeUpload(input, payload, rawSha1Value);
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
}
