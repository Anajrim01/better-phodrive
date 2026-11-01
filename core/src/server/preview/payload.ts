import { Err, Ok, type AsyncResult } from 'results-ts';
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

export function readStoredPayload(reader: SplitBmpReader): AsyncResult<Uint8Array, ServerError> {
    return Ok(undefined).andThenAsync(async () => {
        const parts: Uint8Array[] = [];
        let total = 0;

        while (true) {
            const next = await reader.readPayload();
            let failure: ServerError | null = null;
            const part = next.match({
                Ok: (value) => value,
                Err: (error) => {
                    failure = error;

                    return null;
                }
            });
            if (failure !== null) return Err(failure);
            if (part === null) break;

            parts.push(part);
            total += part.length;
        }

        return Ok(concat(parts, total));
    });
}
