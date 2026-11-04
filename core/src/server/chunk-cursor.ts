import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    splitHeaderIsCompressed,
    type FileRequest,
    type RemoteBmp,
    type SplitHeader
} from '../models';
import { BrotliStreamDecoder } from './bmp/decompress';
import { SplitBmpReader } from './bmp/stream';
import { SERVER_ERRORS, type ServerError } from './errors';
import { downloadBmp } from './photos/index';

/** Download one chunk and check its BMP header matches what the file expects. */
export function openChunk(
    input: FileRequest,
    chunk: RemoteBmp,
    signal: AbortSignal
): AsyncResult<SplitBmpReader, ServerError> {
    const compressed = chunk.storedSize !== undefined;
    const expected: SplitHeader = {
        fileHash: input.fileHash,
        fileId: input.fileId,
        chunkIndex: chunk.chunkIndex,
        flags: (chunk.isLast ? SPLIT_FLAG_LAST : 0) | (compressed ? SPLIT_FLAG_COMPRESSED : 0),
        payloadSize: compressed ? chunk.storedSize! : chunk.size,
        originalSize: compressed ? chunk.size : undefined,
        fileName: chunk.chunkIndex === 0 ? input.name : undefined,
        folder: chunk.chunkIndex === 0 ? chunk.folder : undefined
    };

    return downloadBmp(
        input.email,
        input.token,
        chunk.mediaKey,
        chunk.sha1,
        undefined,
        signal
    ).andThenAsync((response) => SplitBmpReader.open(response, expected, chunk.sha1));
}

/** Close a chunk opened after the download was already cancelled. */
async function closeLate(opened: Result<SplitBmpReader, ServerError>): Promise<void> {
    const closed = await opened.andThenAsync((reader) => reader.close());

    closed.inspectErr((error) => console.error(error.message));
}

/** Reads chunks in file order, opening each one only when its first byte is needed. */
export class ChunkCursor {
    closed = false;
    private active: SplitBmpReader | null = null;
    private decoder: BrotliStreamDecoder | null = null;
    private decoded: Uint8Array[] = [];
    private activeEnded = false;
    private index = 0;
    private readonly abort = new AbortController();

    constructor(
        private readonly input: FileRequest,
        private readonly chunks: RemoteBmp[]
    ) {}

    get signal(): AbortSignal {
        return this.abort.signal;
    }

    /** Continue from a chunk the caller opened with this cursor's signal. */
    begin(reader: SplitBmpReader): void {
        this.active = reader;
        this.startDecoder(reader);
    }

    /** The next original payload block, or null after the last chunk. */
    next(): AsyncResult<Uint8Array | null, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            while (!this.closed) {
                if (this.decoded.length) return Ok(this.decoded.shift()!);

                const reader = this.active;
                if (!reader) {
                    if (this.index === this.chunks.length) return Ok(null);

                    const opened = await this.openNext();
                    if (opened.isErr()) return opened;

                    continue;
                }

                if (!this.activeEnded) {
                    const next = await reader.readPayload();
                    if (this.closed || next.isErr()) return next;

                    const payload = next.unwrapOr(null);
                    if (payload) {
                        if (!this.decoder) return Ok(payload);

                        const pushed = await this.decoder.push(payload);
                        if (pushed.isErr()) return pushed;
                        this.decoded.push(...pushed.unwrap());
                        continue;
                    }

                    this.activeEnded = true;
                }

                if (this.decoder) {
                    const ended = await this.decoder.end();
                    this.decoder = null;
                    if (ended.isErr()) return ended;
                    this.decoded.push(...ended.unwrap());
                    if (this.decoded.length) continue;
                }

                this.active = null;
                this.activeEnded = false;
                this.index++;
            }

            return Err(SERVER_ERRORS.COULD_NOT_READ_THE_DOWNLOADED_FILE);
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        this.abort.abort();
        this.destroyDecoder();
        if (!this.active) return;

        const cancelled = await this.active.close();
        cancelled.inspectErr((error) => console.error(error.message));
        this.active = null;
    }

    private startDecoder(reader: SplitBmpReader): void {
        const header = reader.header;
        if (!header || !splitHeaderIsCompressed(header.flags)) return;

        this.decoder = new BrotliStreamDecoder(header.originalSize!);
        this.activeEnded = false;
    }

    private destroyDecoder(): void {
        this.decoder?.destroy();
        this.decoder = null;
        this.decoded.length = 0;
    }

    private openNext(): AsyncResult<void, ServerError> {
        return Ok(undefined).andThenAsync(async () => {
            const opened = await openChunk(this.input, this.chunks[this.index], this.signal);
            opened.inspect((reader) => {
                this.active = reader;
                this.activeEnded = false;
                this.decoded.length = 0;
                this.startDecoder(reader);
            });
            // Closing already ran, so it could not close a reader opened meanwhile.
            if (this.closed) await closeLate(opened);

            return opened.map(() => undefined);
        });
    }
}
