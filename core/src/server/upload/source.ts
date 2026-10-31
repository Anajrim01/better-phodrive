import type { AsyncResult } from 'results-ts';
import type { ServerError } from '../errors';

export const TRANSFER_BLOCK_BYTES = 64 * 1024;

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
