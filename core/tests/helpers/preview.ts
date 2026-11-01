import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import {
    SPLIT_FLAG_COMPRESSED,
    SPLIT_FLAG_LAST,
    type RemoteBmp,
    type SplitHeader
} from '@madkarmaa/phodrive-core/models';
import { PreviewMode, type FilePreviewRequest } from '@madkarmaa/phodrive-core/preview';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { compressPayload } from '@madkarmaa/phodrive-core/server/compress';
import { downloadBmp } from '@madkarmaa/phodrive-core/server/photos';
import { throttleError } from '@madkarmaa/phodrive-core/server/errors';
import { bmpResponse } from './download';

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function sha1(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

export async function fixture(
    name: string,
    mode: PreviewMode,
    parts: Uint8Array[],
    compress = false
): Promise<{ input: FilePreviewRequest; bmps: Uint8Array[] }> {
    const fileHash = sha256(parts[0] ?? new Uint8Array());
    const fileId = sha256(Buffer.from(`${name}:${fileHash}`));
    const bmps: Uint8Array[] = [];
    const chunks: RemoteBmp[] = [];

    for (const [index, part] of parts.entries()) {
        const stored = compress
            ? (await compressPayload(part)).unwrap()
            : {
                  data: part,
                  compressed: false,
                  originalSize: part.length,
                  storedSize: part.length
              };
        const header: SplitHeader = {
            fileHash,
            fileId,
            chunkIndex: index,
            flags:
                (index === parts.length - 1 ? SPLIT_FLAG_LAST : 0) |
                (stored.compressed ? SPLIT_FLAG_COMPRESSED : 0),
            payloadSize: stored.storedSize,
            originalSize: stored.compressed ? stored.originalSize : undefined,
            fileName: index === 0 ? name : undefined
        };
        const bmp = encodeSplitBmp(stored.data, header).unwrap();
        bmps.push(bmp);
        chunks.push({
            fileHash,
            fileId,
            chunkIndex: index,
            isLast: index === parts.length - 1,
            originalName: index === 0 ? name : undefined,
            size: stored.originalSize,
            storedSize: stored.storedSize,
            compressed: stored.compressed,
            at: 1,
            mediaKey: `chunk-${index}`,
            sha1: sha1(bmp)
        });
    }

    return {
        input: {
            mode,
            email: 'test@example.com',
            token: 'aas_et/test',
            name,
            fileHash,
            fileId,
            chunks
        },
        bmps
    };
}

export function malformedCompressedTextFixture(): {
    input: FilePreviewRequest;
    bmp: Uint8Array;
} {
    const name = 'notes.txt';
    const stored = Buffer.alloc(1_000_000, 0xff);
    const fileHash = sha256(Buffer.from('malformed-compressed-text'));
    const fileId = sha256(Buffer.from(`malformed:${fileHash}`));
    const bmp = encodeSplitBmp(stored, {
        fileHash,
        fileId,
        chunkIndex: 0,
        flags: SPLIT_FLAG_LAST | SPLIT_FLAG_COMPRESSED,
        payloadSize: stored.length,
        originalSize: 2_000_000,
        fileName: name
    }).unwrap();

    return {
        input: {
            mode: PreviewMode.Text,
            email: 'test@example.com',
            token: 'aas_et/test',
            name,
            fileHash,
            fileId,
            chunks: [
                {
                    fileHash,
                    fileId,
                    chunkIndex: 0,
                    isLast: true,
                    originalName: name,
                    size: 2_000_000,
                    storedSize: stored.length,
                    compressed: true,
                    at: 1,
                    mediaKey: 'chunk-0',
                    sha1: sha1(bmp)
                }
            ]
        },
        bmp
    };
}

export function serve(bmps: Uint8Array[]): void {
    vi.mocked(downloadBmp).mockImplementation((_email, _token, key) => {
        const bmp = bmps[Number(key.slice(-1))];
        if (!bmp) return Ok(undefined).andThenAsync(async () => Err(throttleError(1)));

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });
}
