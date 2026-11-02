import { describe, expect, it } from 'vitest';
import { brotliDecompressSync } from 'node:zlib';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { AlbumItem, ByteResponse } from '../src/api';
import { discoverFiles, type ProbeItem } from '../src/discover';
import type { ViewerFailure } from '../src/errors';
import type { Manifest } from '../src/manifest';
import { reassembleFile } from '../src/reassemble';
import { MemorySink } from '../src/sink';
import { makeSplitFile, type SplitFile } from './helpers/bmp';

function asyncOk<T>(value: T): AsyncResult<T, never> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

function asyncErr<T>(failure: ViewerFailure): AsyncResult<T, ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => Err(failure));
}

const ALBUM =
    'https://photos.google.com/share/AF1QipTestAlbum0000000000000000000000000000000000000000000?key=testCapabilityKey0000000000000000000000000000';

function fixture(split: SplitFile) {
    const items: AlbumItem[] = split.chunks.map((_, index) => ({
        id: `${split.fileId}-${index}`,
        url: `https://lh3.googleusercontent.com/pw/${split.fileId.slice(0, 24)}-${index}`,
        downloadUrl: `https://lh3.googleusercontent.com/pw/${split.fileId.slice(0, 24)}-${index}=d`
    }));
    const manifest: Manifest = {
        v: 1,
        album: ALBUM,
        files: [{ id: split.fileId, chunks: split.chunks.length, name: split.name }]
    };
    const bytesByUrl = new Map(
        items.flatMap((item, index) => [
            [item.url, split.chunks[index]] as const,
            [item.downloadUrl, split.chunks[index]] as const
        ])
    );
    const probe: ProbeItem = (item) => asyncOk(bytesByUrl.get(item.url)!.subarray(0, 65_536));
    const fetchBytes = (url: string) => {
        const bytes = bytesByUrl.get(url)!;

        return asyncOk<ByteResponse>({
            status: 200,
            headers: new Headers({ 'content-length': String(bytes.length) }),
            body: new Response(new Uint8Array(bytes)).body!
        });
    };
    const decompress = (bytes: Uint8Array): AsyncResult<Uint8Array, ViewerFailure> => {
        try {
            return asyncOk(new Uint8Array(brotliDecompressSync(bytes)));
        } catch {
            return asyncErr({ code: 'chunk_invalid', message: 'Brotli failed' });
        }
    };

    return { items, manifest, probe, fetchBytes, decompress, bytesByUrl };
}

async function assemble(run: ReturnType<typeof fixture>) {
    const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
    const sink = new MemorySink();
    const result = await reassembleFile(
        plans[0],
        sink,
        run.fetchBytes,
        run.decompress,
        () => undefined
    ).unwrap();

    return {
        result,
        saved: new Uint8Array(await result.blob!.arrayBuffer())
    };
}

async function discoveryFailure(
    run: ReturnType<typeof fixture>,
    items = run.items,
    manifest = run.manifest
) {
    const result = await discoverFiles(items, manifest, run.probe);

    return result.match({ Ok: () => null, Err: (error) => error });
}

async function reassemblyFailure(run: ReturnType<typeof fixture>) {
    const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
    const result = await reassembleFile(
        plans[0],
        new MemorySink(),
        run.fetchBytes,
        run.decompress,
        () => undefined
    );

    return result.match({ Ok: () => null, Err: (error) => error });
}

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
            () => undefined
        );
        const failure = result.match({ Ok: () => null, Err: (error) => error });

        expect(firstBytes).not.toEqual(secondBytes);
        expect(failure?.code).toBe('chunk_invalid');
    });
});
