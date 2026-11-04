import { createHash } from 'node:crypto';
import { Ok } from 'results-ts';
import { expect, test, vi } from 'vitest';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { encodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { scanLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { downloadMetadata, imageDownload } from '../helpers/protobuf';

const HEADERS = { commonHeaders: {}, rpcHeaders: {} } as unknown as Parameters<
    typeof scanLibraryPage
>[1];

function item(mediaKey = 'media-key') {
    const payload = Uint8Array.of(1, 2, 3, 4);
    const fileHash = createHash('sha256').update('file').digest('hex');
    const fileId = createHash('sha256').update('file-id').digest('hex');
    const bmp = Buffer.from(
        encodeSplitBmp(payload, {
            fileHash,
            fileId,
            chunkIndex: 0,
            flags: 1,
            payloadSize: payload.length,
            fileName: 'note.bin'
        }).unwrap()
    );
    const sha1 = createHash('sha1').update(bmp).digest('hex');
    const candidate = { mediaKey, sha1, size: bmp.length, at: 42 };
    const record: ChunkMetadataRecord = {
        mediaKey,
        sha1,
        storedBmpSize: bmp.length,
        fileHash,
        fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: 'note.bin',
        size: payload.length
    };

    return { bmp, candidate, record };
}

function store(rows: readonly ChunkMetadataRecord[] = []): ChunkMetadataStore & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
} {
    const map = new Map(rows.map((row) => [row.mediaKey, row]));
    const load = vi.fn(() => Ok(map).andThenAsync(async (value) => Ok(value)));
    const save = vi.fn(() => Ok(undefined).andThenAsync(async () => Ok(undefined)));

    return {
        load,
        save
    };
}

function fetcherFor(bmp: Buffer, sha1: string): Fetcher {
    return async (input) => {
        const url = String(input);
        if (url.includes('PhotosPrepareDownload')) {
            return new Response(
                Uint8Array.from(
                    downloadMetadata(
                        'media-key',
                        Buffer.from(sha1, 'hex'),
                        imageDownload('https://lh3.googleusercontent.com/p/media-key=d')
                    )
                )
            );
        }
        if (url.startsWith('https://lh3.googleusercontent.com')) {
            return new Response(Uint8Array.from(bmp), { status: 206 });
        }

        throw new Error(`Unexpected request ${url}`);
    };
}

test('a matching metadata row skips both Google probe requests', async () => {
    const { candidate, record } = item();
    const metadata = store([record]);
    const fetcher = vi.fn<Fetcher>();
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(metadata.load).toHaveBeenCalledOnce();
    expect(metadata.load).toHaveBeenCalledWith([candidate]);
    expect(metadata.save).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.unwrap().items).toEqual([
        expect.objectContaining({
            mediaKey: candidate.mediaKey,
            sha1: candidate.sha1,
            at: candidate.at,
            fileId: record.fileId,
            originalName: 'note.bin',
            size: 4
        })
    ]);
});

test('a missing row probes once and saves the resolved metadata', async () => {
    const { bmp, candidate } = item();
    const metadata = store();
    const fetcher = fetcherFor(bmp, candidate.sha1);
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(result.unwrap().items).toHaveLength(1);
    expect(metadata.save).toHaveBeenCalledOnce();
    expect(metadata.save.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
            mediaKey: candidate.mediaKey,
            sha1: candidate.sha1,
            storedBmpSize: bmp.length,
            fileId: expect.any(String)
        })
    ]);
});

test('changed fingerprint or size is not reused', async () => {
    const { bmp, candidate, record } = item();
    const changed = { ...candidate, sha1: 'f'.repeat(40) };
    const metadata = store([{ ...record, sha1: 'e'.repeat(40) }]);
    const result = await scanLibraryPage(
        { items: [changed], nextPageToken: '' },
        HEADERS,
        fetcherFor(bmp, changed.sha1),
        metadata
    );

    expect(result.unwrap().items).toHaveLength(1);
    expect(metadata.save).toHaveBeenCalledOnce();

    const sized = store([{ ...record, storedBmpSize: record.storedBmpSize + 1 }]);
    await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcherFor(bmp, candidate.sha1),
        sized
    );
    expect(sized.save).toHaveBeenCalledOnce();
});

test('a page of 5,000 indexed unique candidates makes no Google probe calls', async () => {
    const { record } = item();
    const candidates = Array.from({ length: 5_000 }, (_, index) => ({
        mediaKey: `key-${index}`,
        sha1: createHash('sha1').update(`chunk-${index}`).digest('hex'),
        size: record.storedBmpSize,
        at: index
    }));
    const metadata = store(
        candidates.map((candidate, index) => ({
            ...record,
            mediaKey: candidate.mediaKey,
            sha1: candidate.sha1,
            fileHash: createHash('sha256').update(`file-${index}`).digest('hex'),
            fileId: createHash('sha256').update(`file-id-${index}`).digest('hex')
        }))
    );
    const fetcher = vi.fn<Fetcher>();

    const result = await scanLibraryPage(
        { items: candidates, nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(result.unwrap().items).toHaveLength(5_000);
    expect(fetcher).not.toHaveBeenCalled();
    expect(metadata.load).toHaveBeenCalledOnce();
    expect(metadata.save).not.toHaveBeenCalled();
});
