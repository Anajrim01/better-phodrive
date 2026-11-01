import { Err, Ok, type AsyncResult } from 'results-ts';
import { COMPRESSION_PROBE_BYTES } from '../compress';
import { SERVER_ERRORS, type ServerError } from '../errors';
import type { ReceivedUpload } from './input';

export interface PayloadProbe {
    bytes: Uint8Array;
    pending: Uint8Array;
    whole: Uint8Array | null;
    reader: ReadableStreamDefaultReader<Uint8Array>;
    done: boolean;
}

const IDLE_TIMEOUT_MS = 30_000;

function readPart(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('idle'));
        }, IDLE_TIMEOUT_MS);
        const onAbort = () => {
            cleanup();
            reject(new Error('aborted'));
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
        };

        signal.addEventListener('abort', onAbort, { once: true });
        reader.read().then(
            (next) => {
                cleanup();
                resolve(next);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            }
        );
    });
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
        await reader.cancel();
    } catch {
        // The caller already has a receive error to report.
    }
}

/** Read only the first probe, leaving the rest of the stream available for raw forwarding. */
export function readProbe(input: ReceivedUpload): AsyncResult<PayloadProbe, ServerError> {
    return Ok(undefined).andThenAsync<PayloadProbe, ServerError>(async () => {
        const size = Math.min(input.header.payloadSize, COMPRESSION_PROBE_BYTES);
        const reader = input.payload.getReader();
        const bytes = new Uint8Array(size);
        let filled = 0;
        let pending: Uint8Array = new Uint8Array();
        let whole: Uint8Array | null = null;
        let first = true;
        let done = false;

        try {
            while (filled < size) {
                const next = await reader.read();
                if (next.done) {
                    done = true;
                    break;
                }
                if (first) {
                    first = false;
                    if (next.value.length === input.header.payloadSize) whole = next.value;
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

        if (whole) {
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done) {
                        done = true;
                        break;
                    }
                    if (next.value.length) {
                        await cancelReader(reader);
                        reader.releaseLock();

                        return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);
                    }
                }
            } catch {
                await cancelReader(reader);
                reader.releaseLock();

                return Err(SERVER_ERRORS.FILE_RECEIVE_FAILED);
            }
        }

        return Ok({ bytes: bytes.subarray(0, filled), pending, whole, reader, done });
    });
}

/** The probe cleared the threshold, so buffer the full chunk before compressing it. */
export function readCompressPayload(
    input: ReceivedUpload,
    probe: PayloadProbe,
    onRead?: (received: number) => void
): AsyncResult<Uint8Array, ServerError> {
    return Ok(undefined).andThenAsync<Uint8Array, ServerError>(async () => {
        const expected = input.header.payloadSize;
        if (probe.whole) {
            probe.reader.releaseLock();
            if (probe.whole.length !== expected) return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);
            onRead?.(expected);

            return Ok(probe.whole);
        }

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
            onRead?.(received);

            while (!probe.done) {
                const next = await readPart(probe.reader, input.signal);
                if (next.done) {
                    probe.done = true;
                    break;
                }
                if (!copy(next.value)) {
                    failed = true;

                    return Err(SERVER_ERRORS.INVALID_CHUNK_SIZE);
                }
                onRead?.(received);
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
export function prependPayload(probe: PayloadProbe): ReadableStream<Uint8Array> {
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
