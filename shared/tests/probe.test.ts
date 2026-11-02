import { describe, expect, it } from 'vitest';
import { Ok } from 'results-ts';
import type { ByteFetcher } from '../src/api';
import { probeItem } from '../src/probe';

const item = {
    id: 'item',
    url: 'https://lh3.googleusercontent.com/pw/thumbnail-token-abcdefghijklmnop',
    downloadUrl: 'https://lh3.googleusercontent.com/pw/thumbnail-token-abcdefghijklmnop=d'
};

describe('probeItem', () => {
    it('reads the original media URL, not the thumbnail', async () => {
        const seen: string[] = [];
        const fetchBytes: ByteFetcher = (url) => {
            seen.push(url);

            return Ok(undefined).andThenAsync(async () =>
                Ok({
                    status: 206,
                    headers: new Headers({ 'content-range': 'bytes 0-0/1' }),
                    body: new Response(new Uint8Array([1])).body!
                })
            );
        };

        const bytes = await probeItem(item, fetchBytes).unwrap();

        expect(seen).toEqual([item.downloadUrl]);
        expect(bytes).toEqual(new Uint8Array([1]));
    });

    it('rejects a shared item that did not answer', async () => {
        const fetchBytes: ByteFetcher = () =>
            Ok(undefined).andThenAsync(async () =>
                Ok({
                    status: 403,
                    headers: new Headers(),
                    body: new Response(null).body!
                })
            );

        const failure = await probeItem(item, fetchBytes).unwrapErr();

        expect(failure.code).toBe('network_failed');
    });
});
