import { Ok, type AsyncResult } from 'results-ts';
import type { RemoteBmp } from '../../models';
import { PreviewUnavailableReason, type PreviewResult } from '../../preview';
import type { SplitBmpReader } from '../bmp/stream';
import { decompressPayload } from '../compress';
import type { ServerError } from '../errors';
import { readStoredPayload } from './payload';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
    if (bytes.length < offset + text.length) return false;

    for (let index = 0; index < text.length; index++) {
        if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }

    return true;
}

function detectImageType(bytes: Uint8Array): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';

    if (
        bytes.length >= PNG_SIGNATURE.length &&
        PNG_SIGNATURE.every((value, index) => bytes[index] === value)
    )
        return 'image/png';

    if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
    if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';

    return null;
}

function imageIsComplete(contentType: string, bytes: Uint8Array): boolean {
    if (contentType === 'image/png')
        return (
            bytes.length >= PNG_IEND.length &&
            PNG_IEND.every(
                (value, index) => bytes[bytes.length - PNG_IEND.length + index] === value
            )
        );

    if (contentType === 'image/gif') return bytes[bytes.length - 1] === 0x3b;

    if (contentType === 'image/jpeg')
        return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;

    if (contentType === 'image/webp') {
        const size =
            (bytes[4] ?? 0) |
            ((bytes[5] ?? 0) << 8) |
            ((bytes[6] ?? 0) << 16) |
            ((bytes[7] ?? 0) << 24);

        return size + 8 === bytes.length;
    }

    return false;
}

export function readImage(
    reader: SplitBmpReader,
    chunk: RemoteBmp
): AsyncResult<PreviewResult, ServerError> {
    return readStoredPayload(reader).andThenAsync(async (stored) => {
        const bytes =
            chunk.compressed === true ? await decompressPayload(stored, chunk.size) : Ok(stored);

        return bytes.andThen<PreviewResult, ServerError>((image) => {
            const contentType = detectImageType(image);
            if (contentType === null)
                return Ok({
                    kind: 'unavailable',
                    reason: PreviewUnavailableReason.UnsupportedImage
                });
            if (!imageIsComplete(contentType, image))
                return Ok({
                    kind: 'unavailable',
                    reason: PreviewUnavailableReason.IncompleteImage
                });

            return Ok({ kind: 'image', bytes: image, contentType });
        });
    });
}
