import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { IHasher } from 'hash-wasm';
import type { ByteFetcher, ByteResponse } from './api';
import type { ChunkHeader } from './bmp';
import { ChunkConsumer, type Decompressor } from './chunk-consumer';
import { viewerFailure, type ViewerFailure } from './errors';
import { MEDIA_RANGE_BYTES } from './limits';
import type { ByteSink } from './sink';

export type { Decompressor } from './chunk-consumer';

function declaredLength(response: ByteResponse): number | null {
    const value = response.headers.get('content-length');
    if (value === null || !/^\d+$/.test(value)) return null;

    return Number(value);
}

function matchesRange(value: string | null, start: number, end: number, total: number): boolean {
    if (value === null) return true;

    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
    if (!match) return false;

    return Number(match[1]) === start && Number(match[2]) === end && Number(match[3]) === total;
}

function cancelled(): ViewerFailure {
    return viewerFailure('cancelled', 'The share changed, so the download stopped.');
}

async function readSegment(
    body: ByteResponse,
    start: number,
    end: number,
    expected: ChunkHeader,
    consumer: ChunkConsumer,
    signal: AbortSignal
): Promise<Result<void, ViewerFailure>> {
    if (body.status !== 206) {
        void body.body.cancel().catch(() => undefined);

        return Err(viewerFailure('chunk_invalid', 'A chunk range did not return partial content.'));
    }
    if (!matchesRange(body.headers.get('content-range'), start, end, expected.totalSize)) {
        void body.body.cancel().catch(() => undefined);

        return Err(viewerFailure('chunk_invalid', 'A chunk range does not match its request.'));
    }

    const length = end - start + 1;
    const declared = declaredLength(body);
    if (declared !== null && declared !== length) {
        void body.body.cancel().catch(() => undefined);

        return Err(viewerFailure('chunk_invalid', 'A chunk range has the wrong download size.'));
    }

    const reader = body.body.getReader();
    let received = 0;

    try {
        for (;;) {
            if (signal.aborted) {
                void reader.cancel().catch(() => undefined);

                return Err(cancelled());
            }

            const next = await reader.read();
            if (next.done) break;

            received += next.value.byteLength;
            if (received > length) {
                void reader.cancel().catch(() => undefined);

                return Err(viewerFailure('chunk_invalid', 'A chunk range sent too many bytes.'));
            }

            const pushed = await consumer.push(next.value);
            if (pushed.isErr()) {
                void reader.cancel().catch(() => undefined);

                return pushed;
            }
        }
    } catch {
        if (signal.aborted) return Err(cancelled());

        return Err(
            viewerFailure('network_failed', 'The shared item stopped before it was complete.')
        );
    }

    if (received !== length)
        return Err(
            viewerFailure('share_incomplete', 'Share incomplete. A chunk range ended early.')
        );

    return Ok(undefined);
}

export function consumeChunkRanges(
    url: string,
    expected: ChunkHeader,
    fetchBytes: ByteFetcher,
    sink: ByteSink,
    hasher: IHasher,
    decompress: Decompressor,
    onProgress: (written: number) => void,
    baseWritten: number,
    signal: AbortSignal
): AsyncResult<number, ViewerFailure> {
    const consumer = ChunkConsumer.create(
        expected,
        sink,
        hasher,
        decompress,
        onProgress,
        baseWritten
    );

    return Ok(undefined).andThenAsync(async () => {
        let offset = 0;

        while (offset < expected.totalSize) {
            if (signal.aborted) return Err(cancelled());

            const end = Math.min(offset + MEDIA_RANGE_BYTES - 1, expected.totalSize - 1);
            const response = await fetchBytes(url, `bytes=${offset}-${end}`, signal);
            const segment = await response.match({
                Err: async (error) => Err(error),
                Ok: (body) => readSegment(body, offset, end, expected, consumer, signal)
            });
            if (segment.isErr()) return segment;

            offset = end + 1;
        }

        return consumer.finish();
    });
}
