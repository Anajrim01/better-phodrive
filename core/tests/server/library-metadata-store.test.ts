import { createHash } from 'node:crypto';
import { Err, Ok } from 'results-ts';
import { expect, test, vi } from 'vitest';
import type {
    ChunkMetadataRecord,
    ChunkMetadataStore
} from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { createThrottleCoordinator } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { encodeSplitBmp } from '../helpers/split-bmp';
import type { Fetcher } from '@madkarmaa/phodrive-core/server/fetcher';
import { scanLibraryPage } from '@madkarmaa/phodrive-core/server/photos/library/probe';
import { downloadMetadata, imageDownload } from '../helpers/protobuf';

const HEADERS = { commonHeaders: {}, rpcHeaders: {} } as unknown as Parameters<
    typeof scanLibraryPage
>[1];

function item(mediaKey = 'media-key', folder?: string) {
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
            fileName: 'note.bin',
            ...(folder ? { folder } : {})
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
        ...(folder ? { folder } : {}),
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
        save,
        remove: () => Ok(undefined).andThenAsync(async () => Ok(undefined))
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

test('a matching foldered row preserves folder without a Google probe', async () => {
    const { candidate, record } = item('media-key', 'Projects/2026');
    const metadata = store([record]);
    const fetcher = vi.fn<Fetcher>();
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.unwrap().items[0]).toMatchObject({ folder: 'Projects/2026' });
});

test('a matching trashed candidate reconstructs trash state without a probe', async () => {
    const { candidate, record } = item('trashed-media', 'Projects/2026');
    const metadata = store([record]);
    const fetcher = vi.fn<Fetcher>();
    const result = await scanLibraryPage(
        { items: [{ ...candidate, trashed: true }], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.unwrap().items[0]).toMatchObject({
        mediaKey: 'trashed-media',
        folder: 'Projects/2026',
        trashed: true
    });
});

test('an unindexed trashed candidate is omitted without probing', async () => {
    const { candidate } = item('cold-trash');
    const metadata = store();
    const fetcher = vi.fn<Fetcher>();
    const result = await scanLibraryPage(
        { items: [{ ...candidate, trashed: true }], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.unwrap().items).toEqual([]);
    expect(metadata.save).not.toHaveBeenCalled();
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

test('a metadata load failure falls back to Google and keeps a warning', async () => {
    const { bmp, candidate } = item();
    const save = vi.fn(() => Ok(undefined).andThenAsync(async () => Ok(undefined)));
    const metadata: ChunkMetadataStore = {
        load: () => Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.METADATA_UNAVAILABLE)),
        save,
        remove: () => Ok(undefined).andThenAsync(async () => Ok(undefined))
    };

    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcherFor(bmp, candidate.sha1),
        metadata
    );
    const page = result.unwrap();

    expect(page.items).toHaveLength(1);
    expect(page.warnings).toContainEqual({ code: 'METADATA_LOAD_FAILED' });
    expect(save).toHaveBeenCalledOnce();
});

test('a metadata save failure keeps the Google files and reports the warning', async () => {
    const { bmp, candidate } = item();
    const metadata: ChunkMetadataStore = {
        load: () => Ok(new Map()).andThenAsync(async (value) => Ok(value)),
        save: () => Ok(undefined).andThenAsync(async () => Err(SERVER_ERRORS.METADATA_SAVE_FAILED)),
        remove: () => Ok(undefined).andThenAsync(async () => Ok(undefined))
    };

    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcherFor(bmp, candidate.sha1),
        metadata
    );
    const page = result.unwrap();

    expect(page.items).toHaveLength(1);
    expect(page.warnings).toContainEqual({ code: 'METADATA_SAVE_FAILED' });
});

test('a throttled probe pauses only the account scope', async () => {
    const { candidate } = item();
    const coordinator = createThrottleCoordinator(() => 0);
    const fetcher = vi.fn<Fetcher>(
        async () => new Response(null, { status: 429, headers: { 'retry-after': '120' } })
    );
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        undefined,
        { key: 'account-a', coordinator }
    );

    expect(result.unwrapErr()).toMatchObject({ code: 'THROTTLED', retryAfterSeconds: 120 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(coordinator.remaining('account-a')).toBeGreaterThan(0);
    expect(coordinator.remaining('account-b')).toBe(0);
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

test('an unindexed folder item probes twice and saves its folder', async () => {
    const { bmp, candidate } = item('media-key', 'Projects/2026');
    const metadata = store();
    let calls = 0;
    const fetcher: Fetcher = (input, init) => {
        calls++;

        return fetcherFor(bmp, candidate.sha1)(input, init);
    };
    const result = await scanLibraryPage(
        { items: [candidate], nextPageToken: '' },
        HEADERS,
        fetcher,
        metadata
    );

    expect(calls).toBe(2);
    expect(result.unwrap().items[0]).toMatchObject({ folder: 'Projects/2026' });
    expect(metadata.save.mock.calls[0]?.[0]).toEqual([
        expect.objectContaining({ folder: 'Projects/2026' })
    ]);
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
