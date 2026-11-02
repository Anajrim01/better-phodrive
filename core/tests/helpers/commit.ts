import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import {
    bytes,
    bytesField,
    integer,
    message,
    numberField,
    parse,
    type Field
} from '@madkarmaa/phodrive-core/server/protobuf';
import type { CommitItem, Transfer } from '../../src/server/photos/upload/transfer';

export function sha1(value: string): Buffer {
    return createHash('sha1').update(value).digest();
}

export function transfer(token: string): Transfer {
    const value = Buffer.from(token);

    return {
        scotty: message(numberField(1, 2), bytesField(2, value)),
        type: 2,
        token: value
    };
}

export function commitItem(name: string, payload: string): CommitItem {
    return { name, sha1: sha1(payload), transfer: transfer(payload) };
}

export function commitShape(body: Buffer): {
    items: CommitItem[];
    device: Field | undefined;
    flags: Field | undefined;
} {
    const request = parse(body).unwrap();
    const media = request.flatMap((field) => {
        if (field.number !== 1 || typeof field.value === 'number') return [];

        return [parse(field.value).unwrap()];
    });

    return {
        items: media.map((item) => {
            const transferField = parse(bytes(item, 1).unwrap()).unwrap();
            const type = integer(transferField, 1).unwrap();
            const token = bytes(transferField, 2).unwrap();

            return {
                name: bytes(item, 2).unwrap().toString(),
                sha1: bytes(item, 3).unwrap(),
                transfer: {
                    scotty: message(numberField(1, type), bytesField(2, token)),
                    type,
                    token
                }
            };
        }),
        device: request.find((field) => field.number === 2),
        flags: request.find((field) => field.number === 3)
    };
}

export function commitBody(
    entries: { transfer: Transfer; key?: string; status?: number; token?: boolean }[]
): Buffer {
    return Buffer.concat(
        entries.map(({ transfer: value, key, status = 0, token = true }) => {
            const fields: Buffer[] = [];
            if (token) fields.push(bytesField(1, value.scotty));
            fields.push(numberField(2, status));
            if (key !== undefined) fields.push(bytesField(3, bytesField(1, key)));

            return bytesField(1, message(...fields));
        })
    );
}

export function commitResponse(
    entries: { transfer: Transfer; key?: string; status?: number; token?: boolean }[]
): Response {
    return new Response(Uint8Array.from(commitBody(entries)));
}

export async function bodyOf(init: RequestInit | undefined): Promise<Buffer> {
    return Buffer.from(await new Response(init?.body).arrayBuffer());
}

export function expectCommitRequest(body: Buffer, expected: CommitItem[]): void {
    const shape = commitShape(body);
    expect(shape.items.map((item) => item.name)).toEqual(expected.map((item) => item.name));
    expect(shape.items.map((item) => item.sha1)).toEqual(expected.map((item) => item.sha1));
    expect(shape.items.map((item) => item.transfer.token)).toEqual(
        expected.map((item) => item.transfer.token)
    );
    expect(shape.device).toBeDefined();
    expect(shape.flags).toBeDefined();
    expect(shape.device?.value).toBeInstanceOf(Buffer);
    expect((shape.device?.value as Buffer).includes(Buffer.from('Pixel XL'))).toBe(true);
    expect((shape.flags?.value as Buffer).equals(Buffer.from([1, 3]))).toBe(true);
}
