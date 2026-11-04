import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { downloadFile } from '@madkarmaa/phodrive-core/browser/files';
import { downloadChunks } from '@madkarmaa/phodrive-core/browser/download';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp } from '../helpers/split-bmp';
import { fixtureBmp, fixtureContent, LEGACY_ROOT_V1 } from '../fixtures/legacy-compression';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

afterEach(() => vi.restoreAllMocks());

const PAYLOAD = Buffer.from('bytes the browser verifies and rebuilds itself');
const NAME = 'decoded.bin';
const FILE_HASH = createHash('sha256').update(PAYLOAD).digest('hex');
const FILE_ID = fileIdentity(NAME, FILE_HASH);
const BMP = encodeSplitBmp(PAYLOAD, {
    fileHash: FILE_HASH,
    fileId: FILE_ID,
    chunkIndex: 0,
    flags: 1,
    payloadSize: PAYLOAD.length,
    fileName: NAME
}).unwrap();

function group() {
    return groupChunks([
        {
            email: 'test@example.com',
            fileHash: FILE_HASH,
            fileId: FILE_ID,
            chunkIndex: 0,
            isLast: true,
            originalName: NAME,
            size: PAYLOAD.length,
            at: 1,
            mediaKey: 'media-key',
            sha1: createHash('sha1').update(BMP).digest('hex')
        }
    ])[0];
}

test('browser mode fetches raw chunks and rebuilds the original bytes', async () => {
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(Uint8Array.from(BMP)));

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(PAYLOAD)).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe('/api/chunk');
    expect(fetch.mock.calls[0][1]?.body).toBe(
        JSON.stringify({ mediaKey: 'media-key', sha1: group().chunks[0].sha1 })
    );
});

test('browser mode routes a legacy compressed file through the server decoder', async () => {
    const bmp = fixtureBmp(LEGACY_ROOT_V1);
    const item = groupChunks([
        {
            email: 'test@example.com',
            accountId: 'account-a',
            fileHash: LEGACY_ROOT_V1.fileHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            isLast: true,
            originalName: LEGACY_ROOT_V1.fileName,
            size: LEGACY_ROOT_V1.originalSize,
            storedSize: LEGACY_ROOT_V1.payloadSize,
            at: 1,
            mediaKey: 'legacy-root',
            sha1: createHash('sha1').update(bmp).digest('hex')
        }
    ])[0]!;
    const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(Uint8Array.from(fixtureContent(LEGACY_ROOT_V1))));

    const downloaded = await downloadFile(item, ProcessingMode.Browser);
    const bytes = new Uint8Array(await downloaded.unwrap().arrayBuffer());

    expect(Buffer.from(bytes).equals(fixtureContent(LEGACY_ROOT_V1))).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('/api/files');
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-phodrive-account-id')).toBe(
        'account-a'
    );
    expect(fetch.mock.calls[0][1]?.body).toContain('"action":"download"');
});

test('the browser decoder rejects compressed chunks directly', async () => {
    const item = groupChunks([
        {
            email: 'test@example.com',
            fileHash: LEGACY_ROOT_V1.fileHash,
            fileId: LEGACY_ROOT_V1.fileId,
            chunkIndex: 0,
            isLast: true,
            originalName: LEGACY_ROOT_V1.fileName,
            size: LEGACY_ROOT_V1.originalSize,
            storedSize: LEGACY_ROOT_V1.payloadSize,
            at: 1,
            mediaKey: 'legacy-root',
            sha1: LEGACY_ROOT_V1.sha1
        }
    ])[0]!;

    const result = await downloadChunks(item);

    expect(result.unwrapErr().code).toBe('COMPRESSED_DOWNLOAD_UNAVAILABLE');
});

test('a damaged chunk fails the integrity check instead of returning bytes', async () => {
    const damaged = Uint8Array.from(BMP);
    damaged[BMP.length - PAYLOAD.length - 1] ^= 1;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(damaged));

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
});

test('a truncated chunk is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(Uint8Array.from(BMP.subarray(0, BMP.length - 1)))
    );

    const downloaded = await downloadFile(group(), ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('DOWNLOAD_INTEGRITY_FAILED');
});

test('an incomplete file is refused before any chunk is fetched', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    const downloaded = await downloadFile({ ...group(), complete: false }, ProcessingMode.Browser);

    expect(downloaded.unwrapErr().code).toBe('INCOMPLETE_DOWNLOAD_CHUNKS');
    expect(fetch).not.toHaveBeenCalled();
});
