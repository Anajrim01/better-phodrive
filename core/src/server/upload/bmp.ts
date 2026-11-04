import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';
import { payloadReader, verifiedStream, type NextBlock } from './verified-stream';

const TRANSFER_BLOCK_BYTES = 64 * 1024;

export interface UploadBmpSource {
    body: ReadableStream<Uint8Array>;
    length: number;
    sha1: string;
    verified: AsyncResult<void, ServerError>;
    drain: () => AsyncResult<void, ServerError>;
}

/** Encode and verify a BMP in fixed-sized pieces before permitting the Google commit. */
export function encodeUploadBmp(input: ReceivedUpload): UploadBmpSource {
    const hash = createHash('sha1');
    const payload = payloadReader(input, input.header.payloadSize);
    const zeros = new Uint8Array(TRANSFER_BLOCK_BYTES);
    let prefixSent = false;
    let payloadDone = false;
    let pending: Uint8Array = new Uint8Array();
    let padding = input.bmp.paddingSize;

    const nextBlock: NextBlock = () =>
        Ok(undefined).andThenAsync(async (): Promise<Result<Uint8Array | null, ServerError>> => {
            if (!prefixSent) {
                prefixSent = true;

                return Ok(input.bmp.prefix);
            }

            while (!pending.length && !payloadDone) {
                const read = await payload.read();
                if (read.isErr()) return read;

                read.inspect((part) => {
                    if (part) pending = part;
                    else payloadDone = true;
                });
            }
            if (pending.length) {
                const block = pending.subarray(0, TRANSFER_BLOCK_BYTES);
                pending = pending.subarray(block.length);

                return Ok(block);
            }
            if (padding > 0) {
                const block = zeros.subarray(0, padding);
                padding -= block.length;

                return Ok(block);
            }

            return Ok(null);
        });

    const hashedBlock: NextBlock = () =>
        nextBlock().andThen((block) => {
            if (block) {
                hash.update(block);

                return Ok(block);
            }

            return hash.digest('hex') === input.sha1
                ? Ok(null)
                : Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);
        });

    const { body, verified } = verifiedStream(hashedBlock, payload);

    return bmpSource(body, verified, input.bmp.totalSize, input.sha1);
}

/**
 * Relay a browser-encoded BMP, verifying that its prefix matches the request metadata and its
 * SHA-1 matches the claimed checksum before Google can commit it. Both checks stay streaming.
 */
export function relayUploadBmp(input: ReceivedUpload): UploadBmpSource {
    const length = input.bmp.totalSize;
    const payload = payloadReader(input, length);
    const hash = createHash('sha1');
    const prefix = input.bmp.prefix;
    let prefixOffset = 0;

    const nextBlock: NextBlock = () =>
        Ok(undefined).andThenAsync(async () => {
            const read = await payload.read();
            if (read.isErr()) return read;

            const block = read.unwrap();
            if (block === null) {
                if (prefixOffset !== prefix.length)
                    return Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);

                return hash.digest('hex') === input.sha1
                    ? Ok(null)
                    : Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);
            }

            if (prefixOffset < prefix.length) {
                if (!prefixMatches(block, prefix, prefixOffset))
                    return Err(SERVER_ERRORS.UPLOAD_INTEGRITY_FAILED);

                prefixOffset += Math.min(block.length, prefix.length - prefixOffset);
            }
            hash.update(block);

            return Ok(block);
        });

    const { body, verified } = verifiedStream(nextBlock, payload);

    return bmpSource(body, verified, length, input.sha1);
}

function prefixMatches(received: Uint8Array, expected: Uint8Array, offset: number): boolean {
    const count = Math.min(received.length, expected.length - offset);
    for (let index = 0; index < count; index++)
        if (received[index] !== expected[offset + index]) return false;

    return true;
}

/** Drain lets an already-stored chunk finish reading its request before reporting the result. */
function bmpSource(
    body: ReadableStream<Uint8Array>,
    verified: AsyncResult<void, ServerError>,
    length: number,
    sha1: string
): UploadBmpSource {
    return {
        body,
        verified,
        length,
        sha1,
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
