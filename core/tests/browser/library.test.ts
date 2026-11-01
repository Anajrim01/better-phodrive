import { afterEach, expect, test, vi } from 'vitest';
import { readLibrarySnapshot, readLibraryUpdates } from '@madkarmaa/phodrive-core/browser/library';
import type { RemoteBmp } from '@madkarmaa/phodrive-core/models';

afterEach(() => vi.restoreAllMocks());

function remoteFile(mediaKey: string): RemoteBmp {
    return {
        mediaKey,
        fileHash: '0'.repeat(64),
        fileId: '0'.repeat(64),
        sha1: '0'.repeat(40),
        chunkIndex: 0,
        isLast: true,
        originalName: 'proof.bin',
        size: 4,
        at: 1
    };
}

test('refresh reads the loaded pagination depth and stops when the library ends', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('existing-file')], nextPageToken: '' })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 3);

    expect(refreshed.unwrap().items.map((item) => item.mediaKey)).toEqual([
        'new-upload',
        'existing-file'
    ]);
    expect(refreshed.unwrap().pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
        JSON.stringify({ email: 'test@example.com', token: 'aas_et/test', pageToken: 'page-two' })
    );
});

test('an incremental refresh merges the newest page into the loaded snapshot', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [
                { ...remoteFile('changed'), originalName: 'renamed.bin' },
                remoteFile('new-upload')
            ],
            nextPageToken: 'a-newer-token'
        })
    );
    const current = [remoteFile('changed'), remoteFile('existing-file')];

    const refreshed = await readLibraryUpdates(
        'test@example.com',
        'aas_et/test',
        current,
        'page-three',
        2
    );
    const snapshot = refreshed.unwrap();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
        JSON.stringify({ email: 'test@example.com', token: 'aas_et/test', pageToken: '' })
    );
    expect(snapshot.items.map((item) => item.mediaKey)).toEqual([
        'changed',
        'existing-file',
        'new-upload'
    ]);
    expect(snapshot.items[0]?.originalName).toBe('renamed.bin');
    expect(snapshot.nextPageToken).toBe('page-three');
    expect(snapshot.pages).toBe(2);
});

test('an incremental refresh starts pagination when nothing was loaded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );

    const refreshed = await readLibraryUpdates('test@example.com', 'aas_et/test', [], '', 0);
    const snapshot = refreshed.unwrap();

    expect(snapshot.items.map((item) => item.mediaKey)).toEqual(['new-upload']);
    expect(snapshot.nextPageToken).toBe('page-two');
    expect(snapshot.pages).toBe(1);
});

test('a failed later page rejects the refresh instead of returning a partial replacement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ error: 'Library unavailable' }, { status: 503 })
    );

    const refreshed = await readLibrarySnapshot('test@example.com', 'aas_et/test', 2);

    expect(refreshed.unwrapErr().message).toBe('Library unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
