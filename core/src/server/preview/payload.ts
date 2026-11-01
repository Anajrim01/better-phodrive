import { Err, Ok, type Result } from 'results-ts';
import type { SplitBmpReader } from '../bmp/stream';
import type { ServerError } from '../errors';

export function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }

    return bytes;
}

export async function readStoredPayload(
    reader: SplitBmpReader
): Promise<Result<Uint8Array, ServerError>> {
    const parts: Uint8Array[] = [];
    let total = 0;

    while (true) {
        const next = await reader.readPayload();
        if (next.isErr()) return Err(next.unwrapErr());

        const part = next.unwrap();
        if (part === null) break;

        parts.push(part);
        total += part.length;
    }

    return Ok(concat(parts, total));
}
