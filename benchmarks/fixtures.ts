import { MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/bmp/format';
import type { SplitHeader } from '@madkarmaa/phodrive-core/models';

export const MIB = 1024 * 1024;
export const CHUNK = MAX_CHUNK_PAYLOAD_BYTES;
export const SIZES: Record<string, number> = {
    tiny: 1024,
    small: 64 * 1024,
    medium: 8 * MIB,
    large: 64 * MIB,
    'very-large': 2 * CHUNK + MIB
};

export function header(size: number): SplitHeader {
    return {
        fileHash: 'ab'.repeat(32),
        fileId: 'cd'.repeat(32),
        chunkIndex: 0,
        flags: 1,
        payloadSize: size,
        fileName: 'photos-??.bin'
    };
}

export function files(sizes: number[]): File[] {
    return sizes.map(
        (size, index) =>
            new File([new Uint8Array(size).fill((index % 251) + 1)], `file-${index}.bin`)
    );
}

export function blocks(bytes: Uint8Array, blockSize = 64 * 1024): ReadableStream<Uint8Array> {
    let offset = 0;

    return new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (offset === bytes.length) {
                    controller.close();

                    return;
                }

                const part = bytes.subarray(offset, offset + blockSize);
                offset += part.length;
                controller.enqueue(part);
            }
        },
        { highWaterMark: 0 }
    );
}

export type Workload = {
    run: () => Promise<void> | void;
    bytes: number;
};

export type TransportState = {
    fetcher: typeof fetch | null;
    fetcherWithProgress: ((callback: (sent: number) => void) => typeof fetch) | null;
};
