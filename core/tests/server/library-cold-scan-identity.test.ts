import { beforeEach, expect, test } from 'vitest';
import { groupChunks } from '@madkarmaa/phodrive-core/files';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';
import { listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { clearAuthCache } from '@madkarmaa/phodrive-core/server/photos/auth';
import { clearProbeCache } from '@madkarmaa/phodrive-core/server/photos/library';
import { clearThrottleState } from '@madkarmaa/phodrive-core/server/photos/throttle';
import { hash, libraryChunk } from '../helpers/library-chunks';
import { emptyCounts, fetcherFor, pageBytes, pagesOf } from '../helpers/delta-library';

const EMAIL = 'cold-scan-identity@example.com';
const TOKEN = 'aas_et/cold-scan-identity';
const FILE_NAME = 'same.bin';

beforeEach(() => {
    clearAuthCache();
    clearProbeCache();
    clearThrottleState();
});

test('same name and file hash in two folders stay separate', async () => {
    const payload = Uint8Array.of(1, 2, 3, 4);
    const fileHash = hash('sha256', payload);
    const firstFolder = 'photos/a';
    const secondFolder = 'photos/b';
    const items = [
        libraryChunk({
            fileHash,
            fileId: fileIdentity(FILE_NAME, fileHash, undefined, firstFolder),
            fileName: FILE_NAME,
            chunkIndex: 0,
            chunkCount: 1,
            folder: firstFolder,
            payload,
            mediaKey: 'folder-a'
        }),
        libraryChunk({
            fileHash,
            fileId: fileIdentity(FILE_NAME, fileHash, undefined, secondFolder),
            fileName: FILE_NAME,
            chunkIndex: 0,
            chunkCount: 1,
            folder: secondFolder,
            payload,
            mediaKey: 'folder-b'
        })
    ];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, pagesOf(items), counts, { delta: pageBytes([], '') });

    const page = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap();
    const groups = groupChunks(page.items.map((item) => ({ ...item, email: EMAIL })));

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.folder).sort()).toEqual([firstFolder, secondFolder]);
    expect(new Set(groups.map((group) => group.fileId)).size).toBe(2);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 2, range: 2 });
});

test('the same filename marker with different header file IDs stays separate', async () => {
    const payload = Uint8Array.of(9, 8, 7);
    const fileHash = hash('sha256', payload);
    const firstId = hash('sha256', 'first header file id');
    const secondId = hash('sha256', 'second header file id');
    const shared = {
        fileHash,
        fileName: FILE_NAME,
        chunkIndex: 0,
        chunkCount: 1,
        payload
    };
    const items = [
        libraryChunk({ ...shared, fileId: firstId, mediaKey: 'header-a' }),
        libraryChunk({ ...shared, fileId: secondId, mediaKey: 'header-b' })
    ];
    const counts = emptyCounts();
    const fetcher = fetcherFor(items, pagesOf(items), counts, { delta: pageBytes([], '') });

    const page = (await listBmps(EMAIL, TOKEN, '', fetcher)).unwrap();
    const groups = groupChunks(page.items.map((item) => ({ ...item, email: EMAIL })));

    expect(page.items.map((item) => item.fileId).sort()).toEqual([firstId, secondId].sort());
    expect(groups).toHaveLength(2);
    expect(counts).toEqual({ auth: 1, page: 1, delta: 0, prepare: 2, range: 2 });
});
