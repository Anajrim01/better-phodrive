import { brotliDecompressSync } from 'node:zlib';
import { Err, Ok, type AsyncResult } from 'results-ts';
import type { AlbumItem, ByteFetcher, ByteResponse } from '../../src/api';
import { discoverFiles, type ProbeItem } from '../../src/discover';
import type { ViewerFailure } from '../../src/errors';
import type { Manifest } from '../../src/manifest';
import { reassembleFile } from '../../src/reassemble';
import { MemorySink } from '../../src/sink';
import type { SplitFile } from './bmp';

export function asyncOk<T>(value: T): AsyncResult<T, never> {
    return Ok(undefined).andThenAsync(async () => Ok(value));
}

export function asyncErr<T>(failure: ViewerFailure): AsyncResult<T, ViewerFailure> {
    return Ok(undefined).andThenAsync(async () => Err(failure));
}

const ALBUM =
    'https://photos.google.com/share/AF1QipTestAlbum0000000000000000000000000000000000000000000?key=testCapabilityKey0000000000000000000000000000';

export type Fixture = ReturnType<typeof fixture>;

export function fixture(split: SplitFile) {
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
    const fetchBytes: ByteFetcher = (url, range) => {
        const bytes = bytesByUrl.get(url)!;
        const [start, end] = range.slice(6).split('-').map(Number);
        const part = bytes.subarray(start, end + 1);

        return asyncOk<ByteResponse>({
            status: 206,
            headers: new Headers({
                'content-length': String(part.length),
                'content-range': `bytes ${start}-${end}/${bytes.length}`
            }),
            body: new Response(new Uint8Array(part)).body!
        });
    };
    const decompress = (
        bytes: Uint8Array,
        originalSize: number
    ): AsyncResult<Uint8Array, ViewerFailure> => {
        try {
            const output = new Uint8Array(brotliDecompressSync(bytes));

            return output.length === originalSize
                ? asyncOk(output)
                : asyncErr({ code: 'integrity_failed', message: 'Brotli size mismatch' });
        } catch {
            return asyncErr({ code: 'chunk_invalid', message: 'Brotli failed' });
        }
    };

    return { items, manifest, probe, fetchBytes, decompress, bytesByUrl };
}

export async function assemble(run: Fixture) {
    const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
    const sink = new MemorySink();
    const result = await reassembleFile(
        plans[0],
        sink,
        run.fetchBytes,
        run.decompress,
        () => undefined,
        new AbortController().signal
    ).unwrap();

    return {
        result,
        saved: new Uint8Array(await result.blob!.arrayBuffer())
    };
}

export async function discoveryFailure(run: Fixture, items = run.items, manifest = run.manifest) {
    const result = await discoverFiles(items, manifest, run.probe);

    return result.match({ Ok: () => null, Err: (error) => error });
}

export async function reassemblyFailure(run: Fixture) {
    const plans = await discoverFiles(run.items, run.manifest, run.probe).unwrap();
    const result = await reassembleFile(
        plans[0],
        new MemorySink(),
        run.fetchBytes,
        run.decompress,
        () => undefined,
        new AbortController().signal
    );

    return result.match({ Ok: () => null, Err: (error) => error });
}
