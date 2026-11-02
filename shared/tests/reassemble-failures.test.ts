import { describe, expect, it } from 'vitest';
import { discoverFiles } from '../src/discover';
import type { Manifest } from '../src/manifest';
import { reassembleFile } from '../src/reassemble';
import { MemorySink } from '../src/sink';
import { encodeChunk, makeSplitFile } from './helpers/bmp';
import { discoveryFailure, fixture, reassemblyFailure } from './helpers/reassemble';

describe('reassembly failures', () => {
    it('fails closed when a chunk is missing', async () => {
        const split = makeSplitFile({
            name: 'missing.bin',
            data: new Uint8Array(300).fill(1),
            chunks: 3
        });
        const run = fixture(split);
        const failure = await discoveryFailure(run, run.items.slice(0, 2));

        expect(failure?.code).toBe('share_incomplete');
    });

    it('fails closed when a whole file is missing', async () => {
        const first = makeSplitFile({
            name: 'one.bin',
            data: new Uint8Array(100).fill(1),
            chunks: 1
        });
        const second = makeSplitFile({
            name: 'two.bin',
            data: new Uint8Array(100).fill(2),
            chunks: 1
        });
        const run = fixture(first);
        const manifest: Manifest = {
            ...run.manifest,
            files: [...run.manifest.files, { id: second.fileId, chunks: 1, name: second.name }]
        };
        const failure = await discoveryFailure(run, run.items, manifest);

        expect(failure?.code).toBe('share_incomplete');
    });

    it('fails closed when the last marker is missing', async () => {
        const split = makeSplitFile({
            name: 'nolast.bin',
            data: new Uint8Array(300).fill(1),
            chunks: 3,
            omitLastFlag: true
        });
        const run = fixture(split);
        const failure = await discoveryFailure(run);

        expect(failure?.code).toBe('share_incomplete');
    });

    it('rejects a duplicate chunk index', async () => {
        const split = makeSplitFile({
            name: 'duplicate.bin',
            data: new Uint8Array(200).fill(1),
            chunks: 2
        });
        const run = fixture(split);
        const chunks = run.items.map((item) => run.bytesByUrl.get(item.url)!);
        run.bytesByUrl.set(run.items[1].url, chunks[0]);
        run.bytesByUrl.set(run.items[1].downloadUrl, chunks[0]);
        const failure = await discoveryFailure(run);

        expect(failure?.code).toBe('share_incomplete');
    });

    it('rejects chunks with mismatched file hashes', async () => {
        const split = makeSplitFile({
            name: 'mixed.bin',
            data: new Uint8Array(200).fill(1),
            chunks: 2
        });
        const run = fixture(split);
        const second = encodeChunk({
            payload: new Uint8Array(3).fill(2),
            fileHash: 'b'.repeat(64),
            fileId: split.fileId,
            index: 1,
            flags: 1
        });
        run.bytesByUrl.set(run.items[1].url, second);
        run.bytesByUrl.set(run.items[1].downloadUrl, second);
        const failure = await discoveryFailure(run);

        expect(failure?.code).toBe('chunk_invalid');
    });

    it('rejects more chunks than the manifest expects', async () => {
        const split = makeSplitFile({
            name: 'extra.bin',
            data: new Uint8Array(200).fill(1),
            chunks: 2
        });
        const run = fixture(split);
        const manifest: Manifest = {
            ...run.manifest,
            files: [{ id: split.fileId, chunks: 1, name: split.name }]
        };
        const failure = await discoveryFailure(run, run.items, manifest);

        expect(failure?.code).toBe('share_incomplete');
    });

    it('rejects non zero padding', async () => {
        const split = makeSplitFile({
            name: 'padding.bin',
            data: new Uint8Array(64).fill(1),
            chunks: 1,
            paddingByte: 9
        });
        const run = fixture(split);
        const failure = await reassemblyFailure(run);

        expect(failure?.code).toBe('chunk_invalid');
    });

    it('rejects a final SHA-256 mismatch', async () => {
        const split = makeSplitFile({
            name: 'badhash.bin',
            data: new Uint8Array(64).fill(1),
            chunks: 1,
            fileHash: 'b'.repeat(64)
        });
        const run = fixture(split);
        const failure = await reassemblyFailure(run);

        expect(failure?.code).toBe('integrity_failed');
    });

    it('rejects a chunk that changed after probing', async () => {
        const split = makeSplitFile({
            name: 'changed.bin',
            data: new Uint8Array(400).fill(1),
            chunks: 2
        });
        const run = fixture(split);
        const firstUrl = run.items[0].url;
        const firstBytes = run.bytesByUrl.get(firstUrl)!;
        const secondBytes = run.bytesByUrl.get(run.items[1].url)!;
        const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
        run.bytesByUrl.set(firstUrl, secondBytes);
        run.bytesByUrl.set(run.items[0].downloadUrl, secondBytes);
        const result = await reassembleFile(
            plans[0],
            new MemorySink(),
            run.fetchBytes,
            run.decompress,
            () => undefined,
            new AbortController().signal
        );
        const failure = result.match({ Ok: () => null, Err: (error) => error });

        expect(firstBytes).not.toEqual(secondBytes);
        expect(failure?.code).toBe('chunk_invalid');
    });
});
