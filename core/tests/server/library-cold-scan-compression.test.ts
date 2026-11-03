import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Ok } from 'results-ts';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { FileActionKind } from '@madkarmaa/phodrive-core/models';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { compressPayload } from '@madkarmaa/phodrive-core/server/compress';
import { downloadFile } from '@madkarmaa/phodrive-core/server/files';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { bmpResponse } from '../helpers/download';
import { emptyCounts, fetcherFor, pageBytes, pagesOf, type Item } from '../helpers/delta-library';
import { concatenate, hash, libraryChunk } from '../helpers/library-chunks';

vi.mock('@madkarmaa/phodrive-core/server/photos/download', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@madkarmaa/phodrive-core/server/photos/download')>();

    return { ...actual, downloadBmp: vi.fn() };
});

const EMAIL = 'cold-scan-compression@example.com';
const TOKEN = 'aas_et/cold-scan-compression';
const FILE_NAME = 'same.bin';

type MixedFile = {
    items: Item[];
    fileHash: string;
    fileId: string;
    bytes: Uint8Array;
};

async function mixedCompressionFile(): Promise<MixedFile> {
    const first = Uint8Array.of(11, 12, 13);
    const second = new Uint8Array(8 * 1024).fill(7);
    const bytes = concatenate([first, second]);
    const fileHash = hash('sha256', bytes);
    const folder = 'photos/mixed';
    const fileId = fileIdentity(FILE_NAME, fileHash, undefined, folder);
    const compressed = (await compressPayload(second)).unwrap();
    if (!compressed.compressed) throw new Error('Fixture must compress the second chunk');

    return {
        bytes,
        fileHash,
        fileId,
        items: [
            libraryChunk({
                fileHash,
                fileId,
                fileName: FILE_NAME,
                chunkIndex: 0,
                chunkCount: 2,
                folder,
                payload: first,
                mediaKey: 'mixed-0'
            }),
            libraryChunk({
                fileHash,
                fileId,
                fileName: FILE_NAME,
                chunkIndex: 1,
                chunkCount: 2,
                payload: second,
                stored: compressed.data,
                compressed: true,
                mediaKey: 'mixed-1'
            })
        ]
    };
}

beforeEach(() => {
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
});

afterEach(() => {
    vi.mocked(downloadBmp).mockReset();
    clearProbeCache();
    clearThrottleState();
});

test('chunks of one file keep different compression states and sizes', async () => {
    const fixture = await mixedCompressionFile();
    const counts = emptyCounts();
    const fetcher = fetcherFor(fixture.items, pagesOf(fixture.items), counts, {
        delta: pageBytes([], '')
    });

    const page = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap();
    const chunks = page.items.toSorted((first, second) => first.chunkIndex - second.chunkIndex);
    const groups = groupChunks(page.items.map((item) => ({ ...item, email: EMAIL })));

    expect(chunks.map((chunk) => chunk.compressed)).toEqual([false, true]);
    expect(chunks.map((chunk) => chunk.size)).toEqual([3, 8 * 1024]);
    expect(chunks[1]?.storedSize).toBeLessThan(8 * 1024);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.chunks.map((chunk) => chunk.compressed)).toEqual([false, true]);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 2, range: 2 });
});

test('a download after a cold scan uses every resolved chunk header', async () => {
    const fixture = await mixedCompressionFile();
    const counts = emptyCounts();
    const fetcher = fetcherFor(fixture.items, pagesOf(fixture.items), counts, {
        delta: pageBytes([], '')
    });
    const page = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap();
    const groups = groupChunks(page.items.map((item) => ({ ...item, email: EMAIL })));
    const group = groups[0];
    if (!group) throw new Error('Missing scanned file');
    expect(group.complete).toBe(true);
    expect(group.chunks.every((chunk) => chunk.fileId === fixture.fileId)).toBe(true);
    expect(group.chunks.every((chunk) => chunk.storedSize !== undefined)).toBe(true);

    const bmps = new Map(fixture.items.map((item) => [item.mediaKey, item.bmp]));
    vi.mocked(downloadBmp).mockImplementation((_email, _token, mediaKey) => {
        const bmp = bmps.get(mediaKey);
        if (!bmp) throw new Error(`Missing download for ${mediaKey}`);

        return Ok(bmpResponse(bmp)).andThenAsync(async (response) => Ok(response));
    });

    const downloaded = await downloadFile({
        action: FileActionKind.Download,
        email: EMAIL,
        token: TOKEN,
        name: group.name,
        fileHash: group.fileHash,
        fileId: group.fileId,
        chunks: group.chunks,
        workers: 1
    });
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(Buffer.from(fixture.bytes))).toBe(true);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 2, range: 2 });
});
