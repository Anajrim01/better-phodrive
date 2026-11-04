import { createHash } from 'node:crypto';
import { Ok } from 'results-ts';
import { expect, test, vi } from 'vitest';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { scanLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { downloadMetadata, imageDownload } from '../helpers/protobuf';
import { fixtureBmp, LEGACY_FOLDER_V2, LEGACY_ROOT_V1 } from '../fixtures/legacy-compression';

const HEADERS = { commonHeaders: {}, rpcHeaders: {} } as unknown as Parameters<
    typeof scanLibraryPage
>[1];

function compressedRecord(): ChunkMetadataRecord {
    const bmp = fixtureBmp(LEGACY_ROOT_V1);

    return {
        mediaKey: 'legacy-root',
        sha1: LEGACY_ROOT_V1.sha1,
        storedBmpSize: bmp.length,
        fileHash: LEGACY_ROOT_V1.fileHash,
        fileId: LEGACY_ROOT_V1.fileId,
        chunkIndex: 0,
        isLast: true,
        originalName: LEGACY_ROOT_V1.fileName,
        storedSize: LEGACY_ROOT_V1.payloadSize,
        size: LEGACY_ROOT_V1.originalSize
    };
}

function store(rows: readonly ChunkMetadataRecord[] = []): ChunkMetadataStore & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
} {
    const map = new Map(rows.map((row) => [row.mediaKey, row]));
    const load = vi.fn(() => Ok(map).andThenAsync(async (value) => Ok(value)));
    const save = vi.fn(async () => {});

    return { load, save };
}

function fetcherFor(bmp: Buffer, sha1: string, mediaKey = 'media-key'): Fetcher {
    return async (input) => {
        const url = String(input);
        if (url.includes('PhotosPrepareDownload')) {
            return new Response(
                Uint8Array.from(
                    downloadMetadata(
                        mediaKey,
                        Buffer.from(sha1, 'hex'),
                        imageDownload(`https://lh3.googleusercontent.com/p/${mediaKey}=d`)
                    )
                )
            );
        }
        if (url.startsWith('https://lh3.googleusercontent.com'))
            return new Response(Uint8Array.from(bmp), { status: 206 });

        throw new Error(`Unexpected request ${url}`);
    };
}

test('a cold compressed item probes twice and keeps logical and stored sizes', async () => {
    const bmp = fixtureBmp(LEGACY_ROOT_V1);
    const candidate = {
        mediaKey: 'legacy-root',
        sha1: LEGACY_ROOT_V1.sha1,
        size: bmp.length,
        at: 7
    };
    const metadata = store();
    let requests = 0;
    const fetcher: Fetcher = (input, init) => {
        requests++;

        return fetcherFor(bmp, candidate.sha1, candidate.mediaKey)(input, init);
    };

    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(requests).toBe(2);
    expect(result.unwrap().items[0]).toMatchObject({
        fileId: LEGACY_ROOT_V1.fileId,
        isLast: true,
        originalName: LEGACY_ROOT_V1.fileName,
        size: LEGACY_ROOT_V1.originalSize,
        storedSize: LEGACY_ROOT_V1.payloadSize
    });
    expect(metadata.save.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({
            isLast: true,
            size: LEGACY_ROOT_V1.originalSize,
            storedSize: LEGACY_ROOT_V1.payloadSize
        })
    ]);
});

test('an indexed compressed item makes no Google requests and keeps compression metadata', async () => {
    const record = compressedRecord();
    const bmp = fixtureBmp(LEGACY_ROOT_V1);
    const candidate = {
        mediaKey: 'legacy-root',
        sha1: LEGACY_ROOT_V1.sha1,
        size: bmp.length,
        at: 7
    };
    const metadata = store([record]);
    const fetcher = vi.fn<Fetcher>();

    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.unwrap().items[0]).toMatchObject({
        size: LEGACY_ROOT_V1.originalSize,
        storedSize: LEGACY_ROOT_V1.payloadSize,
        isLast: true
    });
});

test('a compressed folder chunk keeps folder, isLast, and both sizes', async () => {
    const bmp = fixtureBmp(LEGACY_FOLDER_V2);
    const candidate = {
        mediaKey: 'legacy-folder',
        sha1: LEGACY_FOLDER_V2.sha1,
        size: bmp.length,
        at: 7
    };
    const metadata = store();
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcherFor(bmp, candidate.sha1, candidate.mediaKey),
        metadata
    );

    expect(result.unwrap().items[0]).toMatchObject({
        isLast: false,
        folder: LEGACY_FOLDER_V2.folder,
        originalName: LEGACY_FOLDER_V2.fileName,
        size: LEGACY_FOLDER_V2.originalSize,
        storedSize: LEGACY_FOLDER_V2.payloadSize
    });
});
