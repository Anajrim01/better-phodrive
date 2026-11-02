import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import {
    bytes,
    bytesField,
    message,
    nested,
    numberField,
    parse
} from '@madkarmaa/phodrive-core/server/protobuf';

/** No provider latency or retained upload bodies; consume every transferred byte. */
export function provider(options: { duplicate?: boolean; failCommit?: boolean } = {}) {
    const stored = new Set<string>();
    const tokens = new Map<string, Buffer>();
    const counts = { auth: 0, lookups: 0, starts: 0, transfers: 0, commits: 0, bytes: 0 };
    const send = async (
        input: Parameters<Fetcher>[0],
        init: Parameters<Fetcher>[1],
        onProgress?: (sent: number) => void
    ): Promise<Response> => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth')) {
            counts.auth++;

            return new Response('Auth=benchmark\nExpiry=9999999999');
        }
        if (url.includes('5084965799730810217')) {
            counts.lookups++;
            const data = Buffer.from(await new Response(init?.body).arrayBuffer());
            const request = parse(data).unwrap();
            const cmqr = bytes(request, 1).unwrap();
            const hashes = parse(cmqr)
                .unwrap()
                .flatMap((field) => {
                    if (field.number !== 1 || typeof field.value === 'number') return [];

                    return [bytes(parse(field.value).unwrap(), 1).unwrap()];
                });
            const entries = hashes.map((hash) => {
                const fields = [bytesField(1, bytesField(1, hash))];
                if (options.duplicate || stored.has(hash.toString('hex')))
                    fields.push(bytesField(2, bytesField(1, 'existing')));

                return bytesField(2, message(...fields));
            });

            return new Response(Uint8Array.from(bytesField(1, message(...entries))));
        }
        if (init?.method === 'PUT') {
            const transfer = ++counts.transfers;
            const reader = new Response(init.body).body!.getReader();
            const hash = createHash('sha1');
            let length = 0;
            try {
                while (true) {
                    const next = await reader.read();
                    if (next.done) break;
                    hash.update(next.value);
                    length += next.value.length;
                    onProgress?.(length);
                }
            } finally {
                reader.releaseLock();
            }
            assert.equal(length, Number(new Headers(init.headers).get('content-length')));
            stored.add(hash.digest('hex'));
            counts.bytes += length;
            const token = Buffer.from(`token-${transfer}`);
            const scotty = message(numberField(1, 2), bytesField(2, token));
            tokens.set(token.toString('hex'), scotty);
            return new Response(Uint8Array.from(scotty));
        }
        if (url.includes('uploadmedia/interactive')) {
            counts.starts++;

            return new Response(null, { headers: { 'x-guploader-uploadid': 'fixture' } });
        }
        if (url.includes('16538846908252377752')) {
            counts.commits++;
            if (options.failCommit) return new Response(null, { status: 503 });
            const data = Buffer.from(await new Response(init?.body).arrayBuffer());
            const entries = parse(data)
                .unwrap()
                .flatMap((field) => {
                    if (field.number !== 1 || typeof field.value === 'number') return [];
                    const token = nested(field.value, 1, 2).unwrap();
                    const scotty = tokens.get(token.toString('hex'));
                    assert.ok(scotty, 'unknown commit token');

                    return [
                        bytesField(
                            1,
                            message(
                                bytesField(1, scotty),
                                numberField(2, 0),
                                bytesField(3, bytesField(1, 'confirmed'))
                            )
                        )
                    ];
                });

            return new Response(Uint8Array.from(message(...entries)));
        }
        assert.fail('Unexpected provider request');
    };
    const fetcher: Fetcher = (input, init) => send(input, init);
    const fetcherWithProgress =
        (onProgress: (sent: number) => void): Fetcher =>
        (input, init) =>
            send(input, init, onProgress);
    return { fetcher, fetcherWithProgress, counts };
}
