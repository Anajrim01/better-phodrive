import { describe, expect, it } from 'vitest';
import type { ByteFetcher, ByteResponse } from '../src/api';
import { discoverFiles } from '../src/discover';
import { reassembleFile } from '../src/reassemble';
import { MemorySink } from '../src/sink';
import { makeSplitFile } from './helpers/bmp';
import { assemble, asyncOk, fixture } from './helpers/reassemble';

describe('reassembly', () => {
    it('rebuilds one uncompressed chunk', async () => {
        const split = makeSplitFile({
            name: 'hello.txt',
            data: new TextEncoder().encode('hello from a single chunk'),
            chunks: 1,
            folder: 'notes'
        });
        const { saved, result } = await assemble(fixture(split));

        expect(saved).toEqual(split.original);
        expect(result.sha256).toBe(split.fileHash);
        expect(result.size).toBe(split.original.length);
    });

    it('rebuilds three uncompressed chunks', async () => {
        const split = makeSplitFile({
            name: 'three.bin',
            data: new Uint8Array(1_000).fill(7),
            chunks: 3
        });
        const { saved } = await assemble(fixture(split));

        expect(saved).toEqual(split.original);
    });

    it('rebuilds twenty chunks', async () => {
        const split = makeSplitFile({
            name: 'twenty.bin',
            data: new Uint8Array(500).fill(3),
            chunks: 20
        });
        const { saved } = await assemble(fixture(split));

        expect(saved).toEqual(split.original);
    });

    it('rebuilds a chunk larger than one media range', async () => {
        const split = makeSplitFile({
            name: 'large.bin',
            data: new Uint8Array(9_000_000).fill(7),
            chunks: 1
        });
        const run = fixture(split);
        const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
        let requests = 0;
        const fetchBytes: ByteFetcher = (url, range, signal) => {
            requests++;

            return run.fetchBytes(url, range, signal);
        };
        const result = await reassembleFile(
            plans[0],
            new MemorySink(),
            fetchBytes,
            run.decompress,
            () => undefined,
            new AbortController().signal
        ).unwrap();
        const saved = new Uint8Array(await result.blob!.arrayBuffer());

        expect(requests).toBeGreaterThan(1);
        expect(saved).toEqual(split.original);
    });

    it('decompresses a single Brotli chunk', async () => {
        const split = makeSplitFile({
            name: 'compact.txt',
            data: new TextEncoder().encode('a'.repeat(20_000)),
            chunks: 1,
            compressed: true
        });
        const { saved } = await assemble(fixture(split));

        expect(saved).toEqual(split.original);
    });

    it('decompresses each Brotli chunk before joining', async () => {
        const split = makeSplitFile({
            name: 'compact-multi.txt',
            data: new TextEncoder().encode('bcdef'.repeat(3_000)),
            chunks: 3,
            compressed: true
        });
        const { saved } = await assemble(fixture(split));

        expect(saved).toEqual(split.original);
    });

    it('stops when the share changes', async () => {
        const split = makeSplitFile({
            name: 'cancelled.bin',
            data: new Uint8Array(300).fill(1),
            chunks: 2
        });
        const run = fixture(split);
        const controller = new AbortController();
        controller.abort();
        const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
        const result = await reassembleFile(
            plans[0],
            new MemorySink(),
            run.fetchBytes,
            run.decompress,
            () => undefined,
            controller.signal
        );
        const failure = result.match({ Ok: () => null, Err: (error) => error });

        expect(failure?.code).toBe('cancelled');
    });

    it('cancels a chunk body with a bad status', async () => {
        const split = makeSplitFile({
            name: 'bad-status.bin',
            data: new Uint8Array(300).fill(1),
            chunks: 1
        });
        const run = fixture(split);
        const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
        let cancelled = false;
        const result = await reassembleFile(
            plans[0],
            new MemorySink(),
            () =>
                asyncOk<ByteResponse>({
                    status: 200,
                    headers: new Headers(),
                    body: new ReadableStream({
                        cancel() {
                            cancelled = true;
                        }
                    })
                }),
            run.decompress,
            () => undefined,
            new AbortController().signal
        );
        const failure = result.match({ Ok: () => null, Err: (error) => error });

        expect(failure?.code).toBe('chunk_invalid');
        expect(cancelled).toBe(true);
    });

    it('stops between ranges when the share changes', async () => {
        const split = makeSplitFile({
            name: 'changed-midway.bin',
            data: new Uint8Array(9_000_000).fill(4),
            chunks: 1
        });
        const run = fixture(split);
        const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
        const controller = new AbortController();
        let requests = 0;
        const fetchBytes: ByteFetcher = (url, range, signal) => {
            requests++;

            const result = run.fetchBytes(url, range, signal);
            if (requests === 1) controller.abort();

            return result;
        };
        const result = await reassembleFile(
            plans[0],
            new MemorySink(),
            fetchBytes,
            run.decompress,
            () => undefined,
            controller.signal
        );
        const failure = result.match({ Ok: () => null, Err: (error) => error });

        expect(failure?.code).toBe('cancelled');
        expect(requests).toBe(1);
    });
});
