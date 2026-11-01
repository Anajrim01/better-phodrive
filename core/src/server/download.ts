import { createHash } from 'node:crypto';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { FileRequest, RemoteBmp } from '../models';
import { splitHeaderIsCompressed } from '../models';
import { SplitBmpReader } from './bmp/stream';
import { BrotliStreamDecoder } from './compress';
import { openChunk } from './chunk-open';
import { SERVER_ERRORS, type ServerError, type ThrottleMode } from './errors';

/** Never buffer the whole file; pull each chunk only when the consumer reads. */
export function streamDownload(
    input: FileRequest,
    chunks: RemoteBmp[],
    requestSignal?: AbortSignal,
    mode: ThrottleMode = 'auto'
): AsyncResult<Response, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const abort = new AbortController();
        const hash = createHash('sha256');
        let active: SplitBmpReader | null = null;
        let decoder: BrotliStreamDecoder | null = null;
        let index = 0;
        let closed = false;
        let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;

        const cleanup = async () => {
            if (closed) return;

            closed = true;
            abort.abort();
            requestSignal?.removeEventListener('abort', onAbort);
            decoder?.destroy();
            decoder = null;

            if (active) {
                const cancelled = await active.close();

                cancelled.inspectErr((error) => console.error(error.message));
                active = null;
            }
        };
        const onAbort = () => {
            if (!closed)
                responseController?.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

            void cleanup();
        };
        requestSignal?.addEventListener('abort', onAbort, { once: true });
        if (requestSignal?.aborted) await cleanup();
        if (closed) return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);

        // Validate the first header before sending a response so HTTP errors reach the browser.
        const first = await openChunk(input, chunks[0], abort.signal, mode);
        if (first.isErr()) {
            await cleanup();

            return first;
        }

        first.inspect((reader) => {
            active = reader;
        });
        if (closed) {
            const cancelled = await first.andThenAsync((reader) => reader.close());

            return cancelled.andThen(() => Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE));
        }

        const body = new ReadableStream<Uint8Array>(
            {
                start(controller) {
                    responseController = controller;
                },
                async pull(controller) {
                    while (!closed) {
                        if (!active) {
                            if (index === chunks.length) {
                                const valid = hash.digest('hex') === input.fileHash;
                                await cleanup();
                                if (!valid) {
                                    controller.error(SERVER_ERRORS.FILE_INTEGRITY_FAILED);

                                    return;
                                }

                                controller.close();

                                return;
                            }

                            const opened = await openChunk(
                                input,
                                chunks[index],
                                abort.signal,
                                mode
                            );

                            opened.inspect((reader) => {
                                active = reader;
                            });
                            if (closed) {
                                const cancelled = await opened.andThenAsync((reader) =>
                                    reader.close()
                                );

                                cancelled.inspectErr((error) => console.error(error.message));

                                return;
                            }
                            if (opened.isErr()) {
                                opened.inspectErr((error) => controller.error(error));
                                await cleanup();

                                return;
                            }
                        }
                        if (!active) return;

                        if (splitHeaderIsCompressed(active.header.flags)) {
                            const originalSize = active.header.originalSize!;
                            const streamDecoder = new BrotliStreamDecoder(originalSize);
                            decoder = streamDecoder;
                            let produced = 0;

                            const emit = (parts: Uint8Array[]): boolean => {
                                for (const part of parts) {
                                    produced += part.length;
                                    if (produced > originalSize) {
                                        controller.error(SERVER_ERRORS.DECOMPRESSION_FAILED);

                                        return false;
                                    }

                                    hash.update(part);
                                    controller.enqueue(part);
                                }

                                return true;
                            };

                            try {
                                while (true) {
                                    const next = await active.readPayload();
                                    if (closed) return;
                                    if (next.isErr()) {
                                        next.inspectErr((error) => controller.error(error));
                                        await cleanup();

                                        return;
                                    }

                                    const part = next.unwrap();
                                    if (part === null) break;
                                    if (!emit(await streamDecoder.push(part))) {
                                        await cleanup();

                                        return;
                                    }
                                }

                                if (!emit(await streamDecoder.end())) {
                                    await cleanup();

                                    return;
                                }
                            } catch (error) {
                                controller.error(error);
                                await cleanup();

                                return;
                            }

                            if (produced !== originalSize) {
                                controller.error(SERVER_ERRORS.DECOMPRESSION_FAILED);
                                await cleanup();

                                return;
                            }

                            active = null;
                            decoder = null;
                            index++;

                            return;
                        }

                        const next = await active.readPayload();
                        if (closed) return;
                        if (next.isErr()) {
                            next.inspectErr((error) => controller.error(error));
                            await cleanup();

                            return;
                        }

                        const delivered = next.match({
                            Ok: (payload) => {
                                if (payload === null) {
                                    active = null;
                                    index++;

                                    return false;
                                }

                                hash.update(payload);
                                controller.enqueue(payload);

                                return true;
                            },
                            Err: () => false
                        });
                        if (delivered) return;
                    }

                    controller.error(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
                },
                cancel: cleanup
            },
            { highWaterMark: 0 }
        );

        return Ok(
            new Response(body, {
                headers: {
                    'content-type': 'application/octet-stream',
                    'cache-control': 'no-store',
                    'x-accel-buffering': 'no'
                }
            })
        );
    });
}
