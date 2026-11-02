import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import {
    bytesField,
    message,
    nested,
    parse,
    type Field
} from '@madkarmaa/phodrive-core/server/protobuf';

export function sha1(value: string): Buffer {
    return createHash('sha1').update(value).digest();
}

export function requestShape(body: Buffer): { hashes: Buffer[]; pageOptions: Field | undefined } {
    const request = parse(body).unwrap();
    expect(request.map((field) => field.number)).toEqual([1]);
    const cmqr = nested(body, 1).unwrap();
    const fields = parse(cmqr).unwrap();
    const hashes = fields.flatMap((field) => {
        if (field.number !== 1 || typeof field.value === 'number') return [];

        return [nested(field.value, 1).unwrap()];
    });

    return { hashes, pageOptions: fields.find((field) => field.number === 2) };
}

function resultEntry(sha1: Buffer, key?: string): Buffer {
    const fields = [bytesField(1, bytesField(1, sha1))];
    if (key !== undefined) fields.push(bytesField(2, bytesField(1, key)));

    return bytesField(2, message(...fields));
}

export function batchResponse(entries: { sha1: Buffer; key?: string }[]): Response {
    return new Response(
        Uint8Array.from(
            bytesField(1, message(...entries.map((entry) => resultEntry(entry.sha1, entry.key))))
        )
    );
}

export async function bodyOf(init: RequestInit | undefined): Promise<Buffer> {
    return Buffer.from(await new Response(init?.body).arrayBuffer());
}
