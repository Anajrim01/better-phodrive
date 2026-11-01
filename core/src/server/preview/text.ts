import { Err, Ok, type AsyncResult, type Result } from 'results-ts';
import type { RemoteBmp } from '../../models';
import { PREVIEW_TEXT_LINES, PreviewUnavailableReason, type PreviewResult } from '../../preview';
import type { SplitBmpReader } from '../bmp/stream';
import type { ServerError } from '../errors';
import { readTextPrefix } from './text-prefix';

function looksBinary(bytes: Uint8Array): boolean {
    if (bytes.length === 0) return false;

    let controls = 0;
    for (const byte of bytes) {
        if (byte === 0) return true;
        if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) controls++;
    }

    return controls > 0 && controls / bytes.length > 0.02;
}

function decodeText(bytes: Uint8Array, prefixBoundary: boolean): Result<string, void> {
    if (bytes.length === 0) return Ok('');
    if (looksBinary(bytes)) return Err(undefined);

    const decoder = new TextDecoder('utf-8', { fatal: true });
    const trims = prefixBoundary ? 3 : 0;
    for (let trim = 0; trim <= trims && trim < bytes.length; trim++) {
        try {
            return Ok(decoder.decode(bytes.subarray(0, bytes.length - trim)));
        } catch {
            continue;
        }
    }

    return Err(undefined);
}

function boundLines(text: string): { text: string; truncated: boolean } {
    const lines = text.split('\n');
    if (lines.length <= PREVIEW_TEXT_LINES) return { text, truncated: false };

    return { text: lines.slice(0, PREVIEW_TEXT_LINES).join('\n'), truncated: true };
}

export function readText(
    reader: SplitBmpReader,
    chunk: RemoteBmp,
    moreChunks: boolean
): AsyncResult<PreviewResult, ServerError> {
    return readTextPrefix(reader, chunk).andThen(({ bytes, truncated }) => {
        const decoded = decodeText(bytes, truncated || moreChunks).match<PreviewResult>({
            Ok: (value) => {
                const bounded = boundLines(value);

                return {
                    kind: 'text',
                    text: bounded.text,
                    truncated: truncated || bounded.truncated || moreChunks
                };
            },
            Err: () => ({ kind: 'unavailable', reason: PreviewUnavailableReason.Binary })
        });

        return Ok(decoded);
    });
}
