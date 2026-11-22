import { afterEach, expect, test, vi } from 'vitest';
import { readLibraryPage, readLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';
import { GOOGLE_ACCOUNT_HEADER, type RemoteBmp } from '@madkarmaa/phodrive-core/models';

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

    const refreshed = await readLibrarySnapshot(3);

    expect(refreshed.unwrap().items.map((item) => item.mediaKey)).toEqual([
        'new-upload',
        'existing-file'
    ]);
    expect(refreshed.unwrap().pages).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ pageToken: 'page-two' }));
});

test('library snapshots merge structured warnings across pages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [remoteFile('new-upload')],
            nextPageToken: 'page-two',
            warnings: [{ code: 'METADATA_SAVE_FAILED' }]
        })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({
            items: [remoteFile('existing-file')],
            nextPageToken: '',
            warnings: [{ code: 'ENTRY_PARSE_FAILED', count: 2 }, { code: 'METADATA_LOAD_FAILED' }]
        })
    );

    const refreshed = await readLibrarySnapshot(2);
    const snapshot = refreshed.unwrap();

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.warnings).toEqual(
        expect.arrayContaining([
            { code: 'METADATA_SAVE_FAILED' },
            { code: 'ENTRY_PARSE_FAILED', count: 2 },
            { code: 'METADATA_LOAD_FAILED' }
        ])
    );
});

test('library pages select their account with the shared header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValue(Response.json({ items: [], nextPageToken: '' }));

    await readLibraryPage('page-two', 'account-one');
    await readLibrarySnapshot(1, 'account-two');

    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get(GOOGLE_ACCOUNT_HEADER)).toBe(
        'account-one'
    );
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ pageToken: 'page-two' }));
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get(GOOGLE_ACCOUNT_HEADER)).toBe(
        'account-two'
    );
});

test('a failed later page rejects the refresh instead of returning a partial replacement', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
        Response.json({ items: [remoteFile('new-upload')], nextPageToken: 'page-two' })
    );
    fetchMock.mockResolvedValueOnce(
        Response.json({ error: 'Library unavailable' }, { status: 503 })
    );

    const refreshed = await readLibrarySnapshot(2);

    expect(refreshed.unwrapErr().message).toBe('Library unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
